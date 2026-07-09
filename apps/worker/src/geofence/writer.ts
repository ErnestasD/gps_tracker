import type { Pool } from 'pg'

/**
 * Geofence transition → events writer (E05-2). Raw SQL over the worker's pool (events are
 * pipeline output; tenant/account resolved from the registry per device). Batched insert;
 * the rule engine + notifications (E05-4) consume these rows, and the events timeline UI
 * (E05-6) reads them.
 */
export interface GeofenceEventRow {
  tenantId: string
  accountId: string
  deviceId: bigint
  at: Date
  lat: number
  lon: number
  payload: { geofenceId: string; name: string; transition: 'enter' | 'exit' }
}

export async function writeGeofenceEvents(pool: Pool, rows: GeofenceEventRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const params: unknown[] = []
  const tuples = rows.map((r, i) => {
    params.push(r.tenantId, r.accountId, r.deviceId.toString(), 'geofence', r.at, r.lat, r.lon, JSON.stringify(r.payload))
    const b = i * 8
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`
  })
  const res = await pool.query(
    `INSERT INTO events ("tenantId","accountId","deviceId","kind","at","lat","lon","payload") VALUES ${tuples.join(',')}`,
    params,
  )
  return res.rowCount ?? 0
}
