import type { Pool } from 'pg'

/**
 * Trip persistence for the pipeline (E04-1, §6.4). Raw SQL over the worker's pg
 * pool — same posture as writePositions: pipeline output, tenant/account resolved
 * from the Redis registry per device, so this is an UNSCOPED-by-design writer, not
 * a tenant-scoped repo. The API read side (scoped list/get) lands with the history
 * API (E04-3). Trips are low-volume → plain INSERT/UPDATE.
 */
export interface TripOpen {
  tenantId: string
  accountId: string
  deviceId: bigint
  startTime: Date
  startLat: number
  startLon: number
}
export interface TripClose {
  endTime: Date
  endLat: number
  endLon: number
  distanceM: number
  distanceSource: 'gps' | 'odometer'
  maxSpeed: number
  idleS: number
  /** auto-resolved driver (V2, Part B) — only fills a still-null driverId; a manual assign wins. */
  driverId?: string | null
}

/** Insert an open trip; returns its id (bigint as string) so the worker can close it. */
export async function openTrip(pool: Pool, t: TripOpen): Promise<string> {
  const res = await pool.query(
    `INSERT INTO trips ("tenantId","accountId","deviceId","status","startTime","startLat","startLon")
     VALUES ($1,$2,$3,'open',$4,$5,$6) RETURNING id`,
    [t.tenantId, t.accountId, t.deviceId.toString(), t.startTime, t.startLat, t.startLon],
  )
  return String((res.rows[0] as { id: string | number }).id)
}

/**
 * `trips."distanceM"` is INTEGER, and the wire field that feeds it is not.
 *
 * AVL id 16 (Total Odometer) is 4 bytes UNSIGNED — 0…4,294,967,295 m per the FMB120 dictionary —
 * while int4 stops at 2,147,483,647. The column cannot hold the top half of the protocol's own
 * range, so a stuck-high or sentinel odometer (0xFFFFFFFF) produces a delta Postgres refuses with
 * 22003, and `closeTrip` THROWS on the hot path: the engine has already dropped the trip from
 * memory, the row stays open until the device's next journey force-closes it at 0 km, and the
 * compensating recompute carries the same value so all three attempts fail and are discarded.
 * A single bad reading therefore destroys one journey's mileage AND disables the authoritative
 * rebuild for every window containing it.
 *
 * `normalize.ts` bounds exactly this class for `positions` ("a ≥2^63 reading raises 22003 and
 * poisons the whole batch") and the trips path never got the same treatment. Clamping is the honest
 * repair for a value we already know is garbage: a saturated distance is visibly wrong to a human,
 * a thrown write is invisible and takes the reconciliation path down with it.
 *
 * This is a BACKSTOP, not the repair: the engine now refuses an over-range odometer delta outright
 * and stores the (already computed, already correct) haversine distance instead, so a saturated
 * value should never reach here. maxSpeed and idleS go through the same helper for uniformity only
 * — `positions.speed` is smallint and capped upstream in normalize.ts, and idleS is seconds within
 * one trip, so neither can approach int4. Do not read their inclusion as evidence that they could.
 */
const INT4_MAX = 2_147_483_647
export const clampInt4 = (n: number): number => (Number.isFinite(n) ? Math.min(INT4_MAX, Math.max(0, Math.trunc(n))) : 0)

/**
 * Finalize an open trip. Guarded on status='open' so a replay/double-close is a no-op.
 *
 * @returns whether a row was actually written. The caller counts `trips_closed_total` from this:
 * incrementing regardless turned every silently-dropped close into a recorded success.
 */
export async function closeTrip(pool: Pool, id: string, t: TripClose): Promise<boolean> {
  const res = await pool.query(
    `UPDATE trips SET "status"='closed', "endTime"=$2, "endLat"=$3, "endLon"=$4,
       "distanceM"=$5, "distanceSource"=$6, "maxSpeed"=$7, "idleS"=$8,
       -- COALESCE: auto-attribution only fills a still-null driver; a manual assignment wins
       "driverId"=COALESCE("driverId", $9)
     WHERE "id"=$1 AND "status"='open'`,
    [id, t.endTime, t.endLat, t.endLon, clampInt4(t.distanceM), t.distanceSource, clampInt4(t.maxSpeed), clampInt4(t.idleS), t.driverId ?? null],
  )
  return res.rowCount === 1
}
