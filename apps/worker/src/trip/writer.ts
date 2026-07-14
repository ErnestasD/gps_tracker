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

/** Finalize an open trip. Guarded on status='open' so a replay/double-close is a no-op. */
export async function closeTrip(pool: Pool, id: string, t: TripClose): Promise<void> {
  await pool.query(
    `UPDATE trips SET "status"='closed', "endTime"=$2, "endLat"=$3, "endLon"=$4,
       "distanceM"=$5, "distanceSource"=$6, "maxSpeed"=$7, "idleS"=$8,
       -- COALESCE: auto-attribution only fills a still-null driver; a manual assignment wins
       "driverId"=COALESCE("driverId", $9)
     WHERE "id"=$1 AND "status"='open'`,
    [id, t.endTime, t.endLat, t.endLon, t.distanceM, t.distanceSource, t.maxSpeed, t.idleS, t.driverId ?? null],
  )
}
