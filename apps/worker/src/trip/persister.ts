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
  private readonly openIds = new Map<string, { id: string; tenantId: string; accountId: string }>() // deviceId → open trip id + its scope (for iButton→driver resolution at close)
  /** deviceId → the shard it was warm-started from, so a shard handed to a peer can be forgotten. */
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
    const res = await this.pool.query<{ id: string; deviceId: string; tenantId: string; accountId: string; shard: number }>(
      `SELECT t."id", t."deviceId", t."tenantId", t."accountId", (d."imei"::numeric % $2)::int AS shard
         FROM trips t JOIN devices d ON d."id" = t."deviceId"::bigint
        WHERE t."status"='open' AND d."imei" ~ '^[0-9]+$' AND (d."imei"::numeric % $2) = ANY($1::numeric[])`,
      [shards, shardCount],
    )
    for (const r of res.rows) {
      this.openIds.set(r.deviceId, { id: r.id, tenantId: r.tenantId, accountId: r.accountId })
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
     *  at once, and it is awaited before the consumers start. */
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
           SELECT fix_time, lat, lon FROM positions
            WHERE device_id = t."deviceId"::bigint AND fix_time >= t."startTime"
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
      this.openIds.delete(r.deviceId)
    }
    return res.rows.length
  }

  /** Returns how many trips were actually opened/closed (for metrics). */
  async apply(events: TripEvent[]): Promise<{ opened: number; closed: number }> {
    let opened = 0
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
          await closeTrip(this.pool, stale.id, {
            endTime: ev.startTime, endLat: ev.startLat, endLon: ev.startLon,
            distanceM: 0, distanceSource: 'gps', maxSpeed: 0, idleS: 0, driverId: null,
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
        this.openIds.set(key, { id, tenantId: scope.tenantId, accountId: scope.accountId })
        opened++
      } else {
        const open = this.openIds.get(key)
        if (open === undefined) continue // no known open row → leave to E04-2 recompute
        // V2 Part B: resolve the trip's iButton to a driver via the tenant's Redis map (best-effort;
        // a lookup miss/blip just leaves driverId null — closeTrip won't overwrite a manual assign)
        const driverId = ev.ibutton !== null ? await this.resolveDriver(open.tenantId, open.accountId, ev.ibutton) : null
        await closeTrip(this.pool, open.id, {
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
        closed++
      }
    }
    return { opened, closed }
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
