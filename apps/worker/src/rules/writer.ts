import type { Pool } from 'pg'

/**
 * Rule event → events writer (E05-4). Variant of the geofence writer that also sets the
 * originating `ruleId` and a per-rule `kind`. Raw parameterized batch INSERT over the
 * worker's pool (events are pipeline output; the events timeline UI (E05-6) reads them and
 * the notification dispatcher (E05-5) consumes them). lat/lon carry the fix coordinates —
 * on an invalid-fix IO event these are the device's last valid coords (§3.4).
 */
export interface RuleEventRow {
  tenantId: string
  accountId: string
  deviceId: bigint
  ruleId: string
  kind: string
  at: Date
  lat: number
  lon: number
  payload: Record<string, unknown>
}

export async function writeRuleEvents(pool: Pool, rows: RuleEventRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const params: unknown[] = []
  const tuples = rows.map((r, i) => {
    params.push(r.tenantId, r.accountId, r.deviceId.toString(), r.ruleId, r.kind, r.at, r.lat, r.lon, JSON.stringify(r.payload))
    const b = i * 9
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`
  })
  const res = await pool.query(
    `INSERT INTO events ("tenantId","accountId","deviceId","ruleId","kind","at","lat","lon","payload") VALUES ${tuples.join(',')}`,
    params,
  )
  return res.rowCount ?? 0
}
