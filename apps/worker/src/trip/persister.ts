import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import type { TripEvent } from './engine.js'
import { closeTrip, openTrip } from './writer.js'

/**
 * Turns TripEngine events into trip rows (E04-1). Resolves each device's
 * tenant/account from the Redis registry (device:tenant / device:account, synced by
 * device CRUD in E03-3) — a trip is NEVER written with a guessed tenant. Tracks the
 * open trip id per device in memory so a close can finalize the right row.
 *
 * Crash posture (audit high). The in-memory map is lost on every restart and lease transfer, and
 * recompute does NOT reconcile the leftovers: its DELETE is `status='closed'`-scoped by design, it
 * is only ever enqueued when a LATE record appears (a clean restart produces none), and the engine
 * has no warm-start, so it simply opens a fresh row when movement resumes. The stale rows are not
 * inert either — reports aggregate trips with no status filter, and `engineHours` scores an open
 * trip as running to `LEAST(now(), $to)`, so every deploy with vehicles mid-trip bills those
 * devices for days of phantom engine hours that grow monotonically.
 *
 * Three parts now close that: `warmStart()` reloads the open ids at boot so a later close finalizes
 * the RIGHT row; a new open for a device that already has one closes the stale row first (never two
 * open rows per device); and `closeOrphans()` sweeps rows whose device never came back.
 */
export class TripPersister {
  // deviceId → open trip id, its scope (for iButton→driver resolution at close) and its START,
  // which a force-close needs to reconstruct the journey from `positions` rather than zero it.
  private readonly openIds = new Map<string, { id: string; tenantId: string; accountId: string; startTime: Date }>()
  /** deviceId → the shard its open trip belongs to, so a shard handed to a peer can be forgotten.
   *  Written by BOTH warmStart and the open path — writing it in only one of them made forgetShard
   *  a no-op for every trip the running process had opened. */
  private readonly shardOf = new Map<string, number>()

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  /**
   * Reload open trip ids from the DB (call once at startup, before consumers start). Without this
   * a close arriving after a restart finds no known id and is dropped, stranding the row forever.
   *
   * Scoped to the shards THIS worker owns (`imei % shardCount`, rule 5) — a platform-wide load
   * would have two workers each believing they own the same open trip.
   */
  async warmStart(shards: readonly number[], shardCount: number): Promise<number> {
    const res = await this.pool.query<{ id: string; deviceId: string; tenantId: string; accountId: string; startTime: Date; shard: number }>(
      `SELECT t."id", t."deviceId", t."tenantId", t."accountId", t."startTime", (d."imei"::numeric % $2)::int AS shard
         FROM trips t JOIN devices d ON d."id" = t."deviceId"::bigint
        WHERE t."status"='open' AND d."imei" ~ '^[0-9]+$' AND (d."imei"::numeric % $2) = ANY($1::numeric[])`,
      [shards, shardCount],
    )
    for (const r of res.rows) {
      this.openIds.set(r.deviceId, { id: r.id, tenantId: r.tenantId, accountId: r.accountId, startTime: r.startTime })
      this.shardOf.set(r.deviceId, Number(r.shard))
    }
    return res.rows.length
  }

  /**
   * Close open rows whose device has produced NO position since `startTime + maxIdleMs` — i.e. the
   * vehicle never came back, so no engine event will ever close them.
   *
   * Scoped to the shards THIS worker owns (rule 5). A platform-wide sweep would let a booting
   * worker finalize a trip a PEER is still driving: the peer's real close is
   * `WHERE id=$1 AND status='open'`, so it would silently match zero rows and the trip would keep
   * the sweep's zeroed figures with no error anywhere. Ends the trip at its device's
   * last known fix (or at startTime when there is none), so engine-hours stops accruing at the
   * truth rather than at `now()`. Idempotent: `closeTrip` is `WHERE status='open'`.
   */
  async closeOrphans(
    maxIdleMs: number,
    shards: readonly number[],
    shardCount: number,
    nowMs: number = Date.now(),
    /** Bounded per run: the FIRST deploy carrying this sweep sees every historically-stranded row
     *  at once. NOTE it is NOT awaited before the consumers start — main.ts deliberately fires it
     *  after them — which is why the delete below is id-checked. */
    limit = 500,
  ): Promise<number> {
    const cutoff = new Date(nowMs - maxIdleMs)
    // The REAL figures come from the trip's own positions, computed here in one aggregate. The
    // first draft wrote placeholder zeros and enqueued a recompute to "repair" them — but recompute
    // DELETEs `status='closed'` rows in its window and rebuilds only from what the engine re-emits,
    // and the canonical orphan is a device that stopped mid-drive, so there is no ignition-off tail
    // and the engine never emits a close. It deleted the row and inserted nothing (reproduced:
    // deleted 1, created 0). The placeholder was not repaired, the trip was destroyed (review high).
    const res = await this.pool.query<{
      id: string; deviceId: string; startTime: Date; startLat: number | null; startLon: number | null
      lastFix: Date | null; lat: number | null; lon: number | null; maxSpeed: number | null
    }>(
      `SELECT t."id", t."deviceId", t."startTime", t."startLat", t."startLon",
              p.fix_time AS "lastFix", p.lat, p.lon, a.max_speed AS "maxSpeed"
         FROM trips t
         JOIN devices d ON d."id" = t."deviceId"::bigint
         LEFT JOIN LATERAL (
           -- fix_valid, like the max_speed lateral below and like tripDistanceM. Without it this
           -- query was half-I5-correct: it ended the trip at an INVALID fix's time and coordinates,
           -- i.e. (0,0) for sentinel firmware — two lines under a comment explaining why Null Island
           -- must be avoided. It also decided WHETHER the trip looked orphaned at all: a device
           -- parked underground reports satellites=0 on schedule, so those rows kept lastFix
           -- fresh and hid a stranded trip from this sweep entirely.
           SELECT fix_time, lat, lon FROM positions
            WHERE device_id = t."deviceId"::bigint AND fix_time >= t."startTime" AND fix_valid
            ORDER BY fix_time DESC LIMIT 1
         ) p ON true
         LEFT JOIN LATERAL (
           SELECT max(speed) AS max_speed FROM positions
            WHERE device_id = t."deviceId"::bigint AND fix_time >= t."startTime" AND fix_valid
         ) a ON true
        WHERE t."status"='open' AND d."imei" ~ '^[0-9]+$' AND (d."imei"::numeric % $2) = ANY($3::numeric[])
          AND COALESCE(p.fix_time, t."startTime") < $1
        LIMIT $4`,
      [cutoff, shardCount, shards, limit],
    )
    for (const r of res.rows) {
      await closeTrip(this.pool, r.id, {
        endTime: r.lastFix ?? r.startTime,
        // no known last fix ⇒ end where it STARTED (not 0,0 — that is Null Island in the Gulf of
        // Guinea, which reverse-geocodes to nonsense); a zero-length trip is at least honest
        endLat: r.lat ?? r.startLat ?? 0,
        endLon: r.lon ?? r.startLon ?? 0,
        distanceM: await this.tripDistanceM(r.deviceId, r.startTime, r.lastFix ?? r.startTime),
        distanceSource: 'gps',
        maxSpeed: r.maxSpeed ?? 0,
        idleS: 0, // not reconstructible without replaying the state machine; 0 is honest
        driverId: null,
      })
      // ONLY if it is still the row we just closed. This sweep runs CONCURRENTLY with the consumers
      // (main.ts fires it as a bare `void (async …)()` after they start), and it awaits an aggregate
      // and a ST_Length per row — during which the returning device's buffered flood can force-close
      // this stale trip and open a NEW one. Deleting by device then dropped the live trip's mapping,
      // so its close was silently ignored AND the next open no longer found a row to force-close:
      // two open rows for one device, both billing engine-hours to now() until the next boot.
      if (this.openIds.get(r.deviceId)?.id === r.id) this.openIds.delete(r.deviceId)
    }
    return res.rows.length
  }

  /** Returns how many trips were actually opened/closed (for metrics). */
  /**
   * @param shard the consumer's own shard. Required so a trip OPENED at runtime can be forgotten on
   * a handoff: `shardOf` used to be written only by `warmStart`, which meant `forgetShard` silently
   * skipped every trip this process opened itself — the exact population a handoff most needs to
   * release. It cannot be derived here: the shard is `imei % shardCount` (see warmStart's query) and
   * a TripEvent carries the numeric device id, not the IMEI, so `deviceId % shardCount` would be a
   * different number that happens to look plausible. The caller is the shard consumer and knows it.
   */
  async apply(events: TripEvent[], shard: number): Promise<{ opened: number; closed: number; missed: number }> {
    let opened = 0
    let missed = 0
    let closed = 0
    for (const ev of events) {
      const key = ev.deviceId.toString()
      if (ev.type === 'open') {
        const scope = await this.resolveScope(key)
        if (scope === null) continue // unregistered device → cannot scope a trip; skip
        // a warm-started row the engine never closed (restart mid-trip): finalize it at this trip's
        // start rather than leaving TWO open rows for one device, which reports would double-count
        const stale = this.openIds.get(key)
        if (stale !== undefined) {
          /**
           * The stale row is a REAL journey, and it used to be written off as zeros.
           *
           * This is the restart case: the engine's state lives in memory, so a worker that
           * redeploys mid-drive comes back with no open trip while the ROW is still open. The next
           * journey force-closes it here — and closing it with `distanceM: 0, maxSpeed: 0` recorded
           * "0 km, 0 km/h" for a drive whose positions are sitting in the database, durable and
           * complete (founder, 2026-09-04: two of three trips that day, 499 positions at up to
           * 100 km/h between them). It also ended the trip at the NEXT one's start, so the parked
           * hours in between were billed to it as duration.
           *
           * Everything needed is in `positions` — the orphan sweep below has always reconstructed
           * exactly this way. There is no reason for the two paths to disagree.
           */
          const end = await this.reconstruct(key, stale.startTime, ev.startTime)
          await closeTrip(this.pool, stale.id, {
            endTime: end?.endTime ?? ev.startTime,
            endLat: end?.endLat ?? ev.startLat,
            endLon: end?.endLon ?? ev.startLon,
            distanceM: end?.distanceM ?? 0,
            distanceSource: 'gps',
            maxSpeed: end?.maxSpeed ?? 0,
            idleS: 0, // not reconstructible without replaying the state machine; 0 is honest
            driverId: null,
          })
          this.openIds.delete(key)
        }
        const id = await openTrip(this.pool, {
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          deviceId: ev.deviceId,
          startTime: ev.startTime,
          startLat: ev.startLat,
          startLon: ev.startLon,
        })
        this.openIds.set(key, { id, tenantId: scope.tenantId, accountId: scope.accountId, startTime: ev.startTime })
        this.shardOf.set(key, shard)
        opened++
      } else {
        const open = this.openIds.get(key)
        if (open === undefined) { missed++; continue } // no known open row → leave to E04-2 recompute
        // V2 Part B: resolve the trip's iButton to a driver via the tenant's Redis map (best-effort;
        // a lookup miss/blip just leaves driverId null — closeTrip won't overwrite a manual assign)
        const driverId = ev.ibutton !== null ? await this.resolveDriver(open.tenantId, open.accountId, ev.ibutton) : null
        const wrote = await closeTrip(this.pool, open.id, {
          endTime: ev.endTime,
          endLat: ev.endLat,
          endLon: ev.endLon,
          distanceM: ev.distanceM,
          distanceSource: ev.distanceSource,
          maxSpeed: ev.maxSpeed,
          idleS: ev.idleS,
          driverId,
        })
        this.openIds.delete(key)
        this.shardOf.delete(key) // nothing reads it for a device with no open trip; keeping it grew unbounded
        // `closed` used to increment unconditionally, which meant `trips_closed_total` counted the
        // 0-row no-ops too — so every close this class of bug drops was recorded as a success and
        // the one metric that could have exposed it instead concealed it. A miss here is not fatal
        // (the guard exists so a replay is idempotent) but it is never NORMAL: it means the row was
        // already closed, or its id was forgotten under us.
        if (wrote) closed++
        else missed++
      }
    }
    return { opened, closed, missed }
  }

  /**
   * Drop the open-trip ids for a shard we no longer own. The new owner warm-starts them and is
   * authoritative; keeping ours would let a later re-gain close a row that peer has already closed
   * or replaced — `closeTrip` is `WHERE status='open'`, so that lands as a silent 0-row UPDATE.
   */
  forgetShard(shard: number): void {
    for (const [deviceId, s] of this.shardOf) {
      if (s !== shard) continue
      this.openIds.delete(deviceId)
      this.shardOf.delete(deviceId)
    }
  }

  /** Great-circle length of the trip's fix_valid track — the same measure the engine accumulates. */
  /**
   * Rebuild a force-closed trip's ending from its own positions: where it really stopped, how far
   * it went, how fast it got.
   *
   * `before` is EXCLUSIVE — it is the next trip's start, and that record belongs to the next trip.
   * Ending at the last valid fix instead of at `before` also stops the parked hours between the two
   * journeys being reported as this one's duration.
   *
   * Null when the window holds no valid fix: there is nothing to reconstruct, and the caller keeps
   * its honest fallback rather than inventing a shape. I5 throughout — an invalid fix places
   * nothing and measures nothing.
   *
   * The orphan sweep above does the same reconstruction inline rather than calling this: it decides
   * WHETHER a row is orphaned from the same aggregates, so they have to be in its WHERE clause.
   */
  private async reconstruct(
    deviceId: string,
    startTime: Date,
    before: Date,
  ): Promise<{ endTime: Date; endLat: number; endLon: number; distanceM: number; maxSpeed: number } | null> {
    const res = await this.pool.query<{ fix_time: Date; lat: number; lon: number; max_speed: number | null; m: string | null }>(
      `SELECT last.fix_time, last.lat, last.lon, agg.max_speed, agg.m
         FROM (SELECT max(speed) AS max_speed,
                      ST_Length(ST_MakeLine(ST_MakePoint(lon, lat) ORDER BY fix_time)::geography) AS m
                 FROM positions
                WHERE device_id = $1::bigint AND fix_time >= $2 AND fix_time < $3 AND fix_valid) agg
         CROSS JOIN LATERAL (
           SELECT fix_time, lat, lon FROM positions
            WHERE device_id = $1::bigint AND fix_time >= $2 AND fix_time < $3 AND fix_valid
            ORDER BY fix_time DESC LIMIT 1
         ) last`,
      [deviceId, startTime, before],
    )
    const r = res.rows[0]
    if (r === undefined) return null
    const m = Number(r.m ?? 0)
    return {
      endTime: r.fix_time,
      endLat: r.lat,
      endLon: r.lon,
      distanceM: Number.isFinite(m) ? Math.round(m) : 0,
      maxSpeed: r.max_speed ?? 0,
    }
  }

  private async tripDistanceM(deviceId: string, from: Date, to: Date): Promise<number> {
    const res = await this.pool.query<{ m: string | null }>(
      `SELECT ST_Length(ST_MakeLine(ST_MakePoint(lon, lat) ORDER BY fix_time)::geography) AS m
         FROM positions
        WHERE device_id = $1::bigint AND fix_time >= $2 AND fix_time <= $3 AND fix_valid`,
      [deviceId, from, to],
    )
    const m = Number(res.rows[0]?.m ?? 0)
    return Number.isFinite(m) ? Math.round(m) : 0
  }

  private async resolveScope(deviceId: string): Promise<{ tenantId: string; accountId: string } | null> {
    const [tenantId, accountId] = await Promise.all([
      this.redis.hget('device:tenant', deviceId),
      this.redis.hget('device:account', deviceId),
    ])
    return tenantId !== null && accountId !== null ? { tenantId, accountId } : null
  }

  /** iButton canonical key → driverId, via the trip's tenant+ACCOUNT Redis map (synced by driver
   *  CRUD in the API). Account-scoped so a tap only resolves to a driver in the TRIP's own account
   *  (the same boundary the manual-assign path enforces). Returns null on a miss or Redis blip —
   *  auto-attribution is best-effort, never blocks the close. */
  private async resolveDriver(tenantId: string, accountId: string, ibuttonKey: string): Promise<string | null> {
    try {
      return await this.redis.hget(`driver:ibutton:${tenantId}:${accountId}`, ibuttonKey)
    } catch {
      return null
    }
  }
}
