import type { NormalizedRecord } from '@orbetra/shared'
import type { Pool, PoolClient } from 'pg'

import { motionRecords } from '../motion.js'
import { DEFAULT_THRESHOLDS, TripEngine, type DeviceTripConfig } from './engine.js'

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
}

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
): Promise<RecomputeResult> {
  const thresholds = config.thresholds
  const dev = deviceId.toString()
  // Recompute reconciles SETTLED, CLOSED history only. It NEVER touches `open` rows: the
  // live streaming persister owns those and holds their ids (deleting one would strand its
  // close). So the core span is bounded by the CLOSED trips overlapping [from,to].
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
  const coreFrom = lo !== null && lo < from ? lo : from
  const coreTo = hi !== null && hi > to ? hi : to
  const marginMs = (Math.max(thresholds.parkedIgnitionOffS, thresholds.parkedStopS) + 120) * 1000
  const readFrom = new Date(coreFrom.getTime() - marginMs)
  const readTo = new Date(coreTo.getTime() + marginMs)

  const pos = await pool.query(
    `SELECT fix_time, server_time, lat, lon, altitude, speed, course, satellites, fix_valid, ignition, movement, odometer_m
     FROM positions WHERE device_id=$1 AND fix_time >= $2 AND fix_time <= $3 ORDER BY fix_time ASC`,
    [dev, readFrom, readTo],
  )
  const records = pos.rows.map((r) => toRecord(deviceId, r as Record<string, unknown>))
  const engine = new TripEngine(thresholds)
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
    const del = await client.query(
      `DELETE FROM trips WHERE "deviceId"=$1 AND status='closed' AND "startTime" >= $2 AND "startTime" <= $3`,
      [dev, coreFrom, coreTo],
    )
    for (const t of trips) {
      await client.query(
        `INSERT INTO trips ("tenantId","accountId","deviceId","status","startTime","endTime","startLat","startLon","endLat","endLon","distanceM","distanceSource","maxSpeed","idleS")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [scope.tenantId, scope.accountId, dev, t.status, t.startTime, t.endTime, t.startLat, t.startLon, t.endLat, t.endLon, t.distanceM, t.distanceSource, t.maxSpeed, t.idleS],
      )
    }
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
    return { deleted: del.rowCount ?? 0, created: trips.length }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
