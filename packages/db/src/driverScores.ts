import type { Pool } from 'pg'

/**
 * Driver safety scoring (V2). Scoped raw SQL over drivers × their assigned trips (trips.driverId,
 * from the trip-driver assignment) + overspeed events that fall within those trips. Lives in
 * packages/db (rule 2), scope-first: bounded by the caller's tenant (+ account when set), never a
 * guessed one. The numeric SCORE itself is computed by the pure `driverScore` helper in
 * packages/shared (the single source for API + web) — this layer only returns the raw aggregates.
 *
 * Overspeed attribution: an overspeed event counts against a driver when it occurred on a device
 * DURING a trip assigned to that driver (event.deviceId = trip.deviceId AND event.at within the
 * trip window). All timestamps are UTC (rule 7); the range bounds are UTC instants, not day math.
 */
export interface DriverScoreScope {
  tenantId: string
  accountId?: string
}
export interface DriverScoreOpts {
  from?: string // ISO; default: 30 days before `to`
  to?: string // ISO; default: now
}
export interface DriverScoreAgg {
  driverId: string
  driverName: string
  trips: number
  distanceM: number
  maxSpeed: number
  idleS: number
  driveS: number
  overspeedEvents: number
}

const MIN_MS = Date.parse('0001-01-01T00:00:00Z')
const MAX_MS = Date.parse('9999-12-31T23:59:59Z')
function validDate(s: string | undefined): Date | null {
  if (s === undefined) return null
  const t = Date.parse(s)
  return Number.isNaN(t) || t < MIN_MS || t > MAX_MS ? null : new Date(t)
}

export async function readDriverScores(pool: Pool, scope: DriverScoreScope, opts: DriverScoreOpts = {}): Promise<DriverScoreAgg[]> {
  const to = validDate(opts.to) ?? new Date()
  const from = validDate(opts.from) ?? new Date(to.getTime() - 30 * 86_400_000)
  // params: $1 tenant, $2 from, $3 to, [$4 account]
  const params: unknown[] = [scope.tenantId, from, to]
  const acct = scope.accountId !== undefined ? ` AND d."accountId" = $${params.push(scope.accountId)}` : ''
  // trips joined per-driver within the window; overspeed events attributed via the trip window.
  const sql = `
    SELECT d.id AS driver_id, d.name AS driver_name,
      count(t.id) AS trips,
      coalesce(sum(t."distanceM"), 0) AS distance_m,
      coalesce(max(t."maxSpeed"), 0) AS max_speed,
      coalesce(sum(t."idleS"), 0) AS idle_s,
      coalesce(sum(EXTRACT(EPOCH FROM (coalesce(t."endTime", $3::timestamptz) - t."startTime"))), 0) AS drive_s,
      coalesce((
        -- count DISTINCT events: if a driver had overlapping trips on one device, an event in the
        -- overlap must count ONCE, not once per matching trip window
        SELECT count(DISTINCT e.id) FROM events e JOIN trips t2
          ON t2."driverId" = d.id AND e."deviceId" = t2."deviceId"
          AND e.at >= t2."startTime" AND e.at <= coalesce(t2."endTime", $3::timestamptz)
          AND t2."startTime" >= $2 AND t2."startTime" <= $3
        WHERE e.kind = 'overspeed'
      ), 0) AS overspeed_events
    FROM drivers d
    LEFT JOIN trips t ON t."driverId" = d.id AND t."startTime" >= $2 AND t."startTime" <= $3
    WHERE d."tenantId" = $1${acct}
    GROUP BY d.id, d.name
    ORDER BY d.name ASC`
  const res = await pool.query<{ driver_id: string; driver_name: string; trips: string; distance_m: string; max_speed: number; idle_s: string; drive_s: string; overspeed_events: string }>(sql, params)
  return res.rows.map((r) => ({
    driverId: r.driver_id,
    driverName: r.driver_name,
    trips: Number(r.trips),
    distanceM: Number(r.distance_m),
    maxSpeed: Number(r.max_speed),
    idleS: Number(r.idle_s),
    driveS: Math.round(Number(r.drive_s)),
    overspeedEvents: Number(r.overspeed_events),
  }))
}
