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

/**
 * Close the state a transition ENDS.
 *
 * A geofence already emits both ends — an `exit` and, later, an `enter` — but as two unrelated
 * rows. "The van left the depot at 08:00" and "the van reached the depot at 17:00" are on screen;
 * "the van was away for nine hours" is the thing an operator actually wants, and nobody was
 * computing it.
 *
 * Each transition closes the most recent OPPOSITE one for the same device and zone, so every
 * geofence event carries how long that state lasted: an `exit` measures time away, an `enter`
 * measures time inside. Symmetric on purpose — a depot and a restricted area are the same mechanism
 * read in opposite directions, and hard-coding which one is "the breach" would be a guess about the
 * customer's zone.
 *
 * Bounded by a window for the same reason the rule extender is: without it, a zone a vehicle left
 * months ago and never returned to would swallow its next visit into a duration of weeks.
 */
const PAIR_WINDOW_S = 14 * 24 * 3_600

export async function closeGeofenceStates(pool: Pool, rows: readonly GeofenceEventRow[]): Promise<number> {
  let closed = 0
  for (const r of rows) {
    const opposite = r.payload.transition === 'enter' ? 'exit' : 'enter'
    const res = await pool.query(
      `UPDATE events SET "endedAt" = $3::timestamptz
       WHERE id = (
         SELECT id FROM events
         WHERE "deviceId" = $1 AND kind = 'geofence'
           AND payload->>'geofenceId' = $2
           AND payload->>'transition' = $4
           AND "endedAt" IS NULL
           AND "at" < $3::timestamptz
           AND "at" >= $3::timestamptz - ($5 || ' seconds')::interval
         ORDER BY "at" DESC
         LIMIT 1
       )`,
      [r.deviceId.toString(), r.payload.geofenceId, r.at, opposite, String(PAIR_WINDOW_S)],
    )
    closed += res.rowCount ?? 0
  }
  return closed
}
