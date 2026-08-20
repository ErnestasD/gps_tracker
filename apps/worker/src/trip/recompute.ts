import type { NormalizedRecord } from '@orbetra/shared'
import type { Pool, PoolClient } from 'pg'

import { motionRecords } from '../motion.js'
import { DEFAULT_THRESHOLDS, TripEngine, type DeviceTripConfig } from './engine.js'
import { clampInt4 } from './writer.js'

const DEFAULT_CONFIG: DeviceTripConfig = { thresholds: DEFAULT_THRESHOLDS, odometerSource: 'auto' }

/**
 * Authoritative trip recompute (E04-2, §6.4). The streaming engine (E04-1) is
 * stateful and drops out-of-order records, so a late/buffered batch cannot reconcile
 * already-persisted trips. This rebuilds trips for a device+window from the DURABLE
 * positions table: expand the window to whole-trip boundaries, replay a fresh engine,
 * then delete-overlap + insert in ONE transaction — idempotent (running it twice over
 * the same positions yields identical trips).
 */
export interface RecomputeScope {
  tenantId: string
  accountId: string
}
export interface RecomputeResult {
  deleted: number
  created: number
  /** Set when the window fell entirely below the positions retention horizon and was declined,
   *  or when even the clamped read hit the row cap with no rebuildable span left. */
  skipped?: 'below_retention' | 'too_many_positions'
  /** Set when the requested window was WIDER than the cap and its tail was not rebuilt. An asset
   *  tracker buffering for weeks is normal, so this is an operator-backfill signal, not an error. */
  truncated?: true
}

/**
 * `positions` is dropped at 13 months (`add_retention_policy('positions', drop_after => interval
 * '13 months')`, packages/db/sql/001_positions.sql). Recompute is DELETE-then-rebuild, so below
 * this horizon it can only destroy. Deliberately a few days SHORTER than the real policy so the
 * floor sits inside surviving data even if the policy is later relaxed.
 */
const POSITIONS_RETENTION_MS = 13 * 30 * 24 * 3_600 * 1_000

/**
 * Hard cap on the WIDTH of one recompute (audit high, review high).
 *
 * The floor alone is not a bound: `to` is always ~now on the production path, so one ancient device
 * timestamp still produced a 13-month window — a DELETE over that device's entire trip history plus
 * a `SELECT … FROM positions` buffering ~1.1 M rows into memory, twice (pg rows + mapped records),
 * inside the process that hosts every shard consumer. That is failure-map #11, and an OOM there
 * takes the pipeline with it. A late record older than this is reconciled by an operator-run
 * backfill, not by a job the device can trigger.
 */
const MAX_RECOMPUTE_WINDOW_MS = 14 * 24 * 3_600 * 1_000

/**
 * Hard cap on the ROW COUNT of one recompute's source read, because the width cap alone is not one.
 * Fourteen days is a bound on TIME, not on volume: a 1 Hz tracker produces ~1.2 M rows inside it,
 * buffered twice (pg rows, then mapped records) in the process that hosts all 16 shard consumers.
 *
 * On overflow the read is not abandoned — it is CLAMPED: we keep the first `MAX_RECOMPUTE_ROWS`
 * (ordered by fix_time) and pull the rebuilt span back to what those rows actually cover, so the
 * DELETE never reaches beyond the data the rebuild saw. That is the invariant that matters; the
 * remaining tail is reported as `truncated` — an operator-backfill signal, not an automatic
 * follow-up: nothing enqueues one, and pretending otherwise would hide a device that needs looking
 * at (an asset tracker buffering for weeks is normal, so this is information, not an error).
 */
const MAX_RECOMPUTE_ROWS = 200_000

interface RecomputedTrip {
  status: 'open' | 'closed'
  startTime: Date
  endTime: Date | null
  startLat: number
  startLon: number
  endLat: number | null
  endLon: number | null
  distanceM: number
  distanceSource: 'gps' | 'odometer'
  maxSpeed: number
  idleS: number
}

/** positions row → NormalizedRecord (only the fields the engine reads matter). */
function toRecord(deviceId: bigint, row: Record<string, unknown>): NormalizedRecord {
  return {
    deviceId,
    fixTime: row['fix_time'] as Date,
    serverTime: (row['server_time'] as Date | null) ?? (row['fix_time'] as Date),
    lat: row['lat'] as number,
    lon: row['lon'] as number,
    altitude: (row['altitude'] as number | null) ?? null,
    speed: (row['speed'] as number | null) ?? null,
    course: (row['course'] as number | null) ?? null,
    satellites: (row['satellites'] as number | null) ?? 0,
    fixValid: row['fix_valid'] as boolean,
    ignition: (row['ignition'] as boolean | null) ?? null,
    movement: (row['movement'] as boolean | null) ?? null,
    odometerM: row['odometer_m'] === null || row['odometer_m'] === undefined ? null : BigInt(row['odometer_m'] as string | number),
    priority: 0,
    recHash: 0n,
    attrs: {},
    // rebuilt from stored rows: nothing was rejected here and the frame is long gone
    rejectReason: null,
    raw: null,
  }
}

export async function recomputeTrips(
  pool: Pool,
  deviceId: bigint,
  from: Date,
  to: Date,
  scope: RecomputeScope,
  // H2: recompute MUST use the same per-device config (thresholds + odometerSource) as the
  // streaming path, else the authoritative rebuild silently diverges (asset segmentation,
  // odometer source) for exactly the devices E04-5 targets.
  config: DeviceTripConfig = DEFAULT_CONFIG,
  /** Same hook the streaming engine gets — see the engine construction below. */
  onOdometerRejected?: (deviceId: bigint) => void,
): Promise<RecomputeResult> {
  const thresholds = config.thresholds
  const dev = deviceId.toString()
  // Recompute reconciles SETTLED, CLOSED history only. It NEVER touches `open` rows: the
  // live streaming persister owns those and holds their ids (deleting one would strand its
  // close). So the core span is bounded by the CLOSED trips overlapping [from,to].
  // Aggregate, not a row set: `from` is an unvalidated device timestamp (ingest §3.6 accepts back to
  // 2020), so materialising every overlapping trip here would let one device with a fallen-back RTC
  // pull its entire history into memory — and then be declined below as `below_retention` anyway.
  const bounds = await pool.query(
    `SELECT MIN("startTime") AS lo, MAX(COALESCE("endTime","startTime")) AS hi
       FROM trips WHERE "deviceId"=$1 AND status='closed' AND "startTime" <= $3 AND COALESCE("endTime","startTime") >= $2`,
    [dev, from, to],
  )
  const lo = (bounds.rows[0] as { lo: Date | null }).lo
  const hi = (bounds.rows[0] as { hi: Date | null }).hi
  // CORE span = the exact time range whose trips we replace. DELETE + INSERT are both keyed
  // on startTime ∈ core, so a neighbour trip that starts OUTSIDE core is never deleted (no
  // margin-bisection). READ is padded by a stop-threshold margin so a target trip's close
  // confirmation (positions after its stop moment) is seen — a closed target trip ends by
  // `hi` = coreTo, so coreTo+margin always covers it.
  // FLOOR the window at the positions retention horizon (audit high). `from` is a raw device
  // timestamp: ingest's §3.6 sanity accepts anything back to 2020-01-01, so an FMB whose RTC fell
  // back after a flat backup battery emits one record stamped years ago, the trip engine files it
  // as late, and `takeLate()` hands that date straight here. `positions` is dropped at 13 months
  // while `trips` has no retention, so the DELETE would succeed over that whole span while the
  // rebuild — fed only by surviving positions — produces nothing. The "run it twice, get the same
  // trips" property silently becomes "wipe every trip older than the source data".
  const retentionFloor = new Date(Date.now() - POSITIONS_RETENTION_MS)
  const rawCoreFrom = lo !== null && lo < from ? lo : from
  let coreTo = hi !== null && hi > to ? hi : to
  // a window entirely below the floor has no source data to rebuild from — deleting there is pure
  // destruction, so decline instead
  if (coreTo <= retentionFloor) return { deleted: 0, created: 0, skipped: 'below_retention' }
  // …and bound the WIDTH, not just the lower edge: `to` is ~now on the production path, so the
  // floor alone still allows a 13-month DELETE + read
  const widthFloor = new Date(coreTo.getTime() - MAX_RECOMPUTE_WINDOW_MS)
  const floor = widthFloor > retentionFloor ? widthFloor : retentionFloor
  const truncated = rawCoreFrom < floor
  const coreFrom = truncated ? floor : rawCoreFrom
  const marginMs = (Math.max(thresholds.parkedIgnitionOffS, thresholds.parkedStopS) + 120) * 1000
  const readFrom = new Date(coreFrom.getTime() - marginMs)
  const readTo = new Date(coreTo.getTime() + marginMs)

  // The "before" picture, captured BEFORE the source read — never after. The DELETE below is keyed
  // on these ids rather than on a time range with `status='closed'` re-evaluated at DELETE time
  // (audit MED): the streaming persister can CLOSE a trip concurrently, and a range delete would
  // erase a row this run never rebuilt, because the rebuild only knows about the events its own
  // positions produced. Silent data loss on an ordinary interleaving, with the job reporting
  // success.
  //
  // The ORDER is the whole point, and it was wrong once already. The rebuild's snapshot is the
  // positions read below; taking the ids after it leaves everything that closes in between doomed
  // AND unrebuilt — and that gap is the duration of the largest query in the job (up to 200k rows),
  // during a buffered flood, which is exactly when the shard consumer is closing that device's
  // historic trips. Taken first, the residual interleaving is benign: a trip closed afterwards is
  // absent from the list and survives, and if the rebuild produced it too, the displacement DELETE
  // below removes the streamed copy.
  const existing = await pool.query<{ id: string; startTime: Date }>(
    `SELECT id, "startTime" FROM trips WHERE "deviceId"=$1 AND status='closed' AND "startTime" >= $2 AND "startTime" <= $3`,
    [dev, coreFrom, coreTo],
  )

  const pos = await pool.query(
    `SELECT fix_time, server_time, lat, lon, altitude, speed, course, satellites, fix_valid, ignition, movement, odometer_m
     FROM positions WHERE device_id=$1 AND fix_time >= $2 AND fix_time <= $3 ORDER BY fix_time ASC LIMIT $4`,
    [dev, readFrom, readTo, MAX_RECOMPUTE_ROWS + 1],
  )
  // Row cap: keep what we read and pull the REBUILT span back to what those rows cover, so the
  // delete can never reach past the data the rebuild saw (see MAX_RECOMPUTE_ROWS).
  let rows = pos.rows
  let rowCapped = false
  if (rows.length > MAX_RECOMPUTE_ROWS) {
    rows = rows.slice(0, MAX_RECOMPUTE_ROWS)
    rowCapped = true
    const lastRead = (rows[rows.length - 1] as { fix_time: Date }).fix_time
    const clampedCoreTo = new Date(lastRead.getTime() - marginMs) // the tail needs its own margin
    if (clampedCoreTo <= coreFrom) return { deleted: 0, created: 0, skipped: 'too_many_positions' }
    coreTo = clampedCoreTo
  }
  const records = rows.map((r) => toRecord(deviceId, r as Record<string, unknown>))

  // …with the same rejection hook. A late buffered flood carrying the bad reading lands HERE, not
  // on the stream, so a counter blind to the rebuild is blind to the common case.
  const engine = new TripEngine(thresholds, onOdometerRejected)
  const events = engine.feed(motionRecords(records), () => config) // I5: invalid fixes filtered; per-device config (H2)

  // keep only CLOSED trips that START within the core span. A trailing open snapshot is
  // deliberately dropped — a trip still moving at readTo is either the live trip (owned by
  // streaming) or a neighbour clipped by the margin; recompute never writes open rows.
  const trips: RecomputedTrip[] = []
  for (const ev of events) {
    if (ev.type === 'close' && ev.startTime >= coreFrom && ev.startTime <= coreTo) {
      trips.push({
        status: 'closed', startTime: ev.startTime, endTime: ev.endTime,
        startLat: ev.startLat, startLon: ev.startLon, endLat: ev.endLat, endLon: ev.endLon,
        distanceM: ev.distanceM, distanceSource: ev.distanceSource, maxSpeed: ev.maxSpeed, idleS: ev.idleS,
      })
    }
  }

  // delete + insert in ONE transaction (idempotent; crash-atomic). DELETE is scoped to
  // CLOSED rows starting in the core span — exactly the set we replace.
  const client: PoolClient = await pool.connect()
  try {
    await client.query('BEGIN')
    // capture existing driver assignments BEFORE the delete so recompute doesn't wipe them — a
    // driverId is a manual assignment OR a prior auto iButton resolution, neither derivable from
    // positions. Ordered so an earlier window wins a same-slot tie (first-writer via the NULL guard).
    const oldDrivers = await client.query<{ startTime: Date; endTime: Date | null; driverId: string }>(
      `SELECT "startTime","endTime","driverId" FROM trips
         WHERE "deviceId"=$1 AND status='closed' AND "startTime" >= $2 AND "startTime" <= $3 AND "driverId" IS NOT NULL
         ORDER BY "startTime"`,
      [dev, coreFrom, coreTo],
    )
    // delete exactly the rows this run read as its "before" picture. A trip closed by streaming
    // after that read is simply not in the list, so it survives instead of vanishing.
    // filtered in JS against the possibly-CLAMPED coreTo (the row cap may have pulled it back after
    // the capture), so the delete still never reaches past the data the rebuild saw
    const doomed = existing.rows.filter((r) => r.startTime <= coreTo).map((r) => r.id)
    const del =
      doomed.length === 0
        ? { rowCount: 0 }
        : // deviceId + status repeated even though the ids came from a scoped read: an id list is
          // implicit scoping, and hard rule 2 exists because implicit scoping is how leaks happen
          await client.query(`DELETE FROM trips WHERE id = ANY($1::int8[]) AND "deviceId"=$2 AND status='closed'`, [doomed, dev])
    const inserted: string[] = []
    for (const t of trips) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO trips ("tenantId","accountId","deviceId","status","startTime","endTime","startLat","startLon","endLat","endLon","distanceM","distanceSource","maxSpeed","idleS")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        // same int4 clamp as the streaming close: the rebuild runs the SAME engine over the SAME
        // positions, so an odometer that overflows the column there overflows it here — and here it
        // aborts the whole transaction, which is how a single bad reading used to make recompute
        // permanently unable to repair the window that contained it
        [scope.tenantId, scope.accountId, dev, t.status, t.startTime, t.endTime, t.startLat, t.startLon, t.endLat, t.endLon, clampInt4(t.distanceM), t.distanceSource, clampInt4(t.maxSpeed), clampInt4(t.idleS)],
      )
      inserted.push(r.rows[0]!.id)
    }

    // Displace anything else occupying a start we just rebuilt. Two rows it removes:
    //
    //  - a CLOSED row for the same journey — the mid-job close, or a duplicate an older overlapping
    //    recompute left behind. §6.4 makes the rebuild authoritative, and it is the one computed
    //    from the late records that triggered the job, so keeping the streamed row would discard the
    //    very correction the job exists to make.
    //  - an OPEN row at that exact start — a trip whose close was LOST (its persist threw, leaving
    //    the row open and its id stranded in the persister's memory). The compensating recompute
    //    then rebuilds the journey as closed, and without this the device carries the same trip
    //    twice: reports aggregate trips with no status filter and score an open trip to `now()`, so
    //    that double-counts distance and engine-hours. A LIVE trip cannot collide here — the rebuild
    //    only emits a CLOSE whose confirmation it actually saw in the positions.
    //
    // Run AFTER the inserts and excluding our own ids, not before them: under READ COMMITTED each
    // statement takes a fresh snapshot, so a close that commits mid-transaction is invisible to an
    // earlier statement but visible to this one. Done first, it left that duplicate behind.
    const rebuiltStarts = trips.map((t) => t.startTime)
    const displaced =
      rebuiltStarts.length === 0
        ? { rowCount: 0 }
        : await client.query(
            `DELETE FROM trips WHERE "deviceId"=$1 AND "startTime" = ANY($2::timestamptz[]) AND id <> ALL($3::int8[])`,
            [dev, rebuiltStarts, inserted],
          )
    // carry each captured driver onto the recomputed trip(s) that START within its old window,
    // only where still unset — so a preserved boundary keeps its driver, a split shares it, and a
    // merge takes the earliest. Positions never carry a driver, so this is the sole carry path.
    for (const od of oldDrivers.rows) {
      await client.query(
        `UPDATE trips SET "driverId"=$4
           WHERE "deviceId"=$1 AND status='closed' AND "driverId" IS NULL AND "startTime" >= $2 AND "startTime" <= $3`,
        [dev, od.startTime, od.endTime ?? od.startTime, od.driverId],
      )
    }
    await client.query('COMMIT')
    return { deleted: (del.rowCount ?? 0) + (displaced.rowCount ?? 0), created: trips.length, ...(truncated || rowCapped ? { truncated: true as const } : {}) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
