import type { Pool } from 'pg'

import { isPgSafeDate } from './dateGuard.js'

/**
 * Report engine (E06-1, §6.6/§7.7). Scoped raw SQL over trips + events (aggregation that
 * Prisma can't express — date_trunc AT TIME ZONE). Lives in packages/db (rule 2) and is
 * scope-first: every query is bounded by the caller's tenant + account, never a guessed one.
 *
 * TIME CORRECTNESS (rule 7 / §7.7): all timestamps are stored UTC; day bucketing converts to
 * the ACCOUNT's IANA zone IN POSTGRES via `at AT TIME ZONE $tz` (DST-correct — Postgres does
 * the offset math, including the Europe/Warsaw 2026-10-25 fall-back). No naive JS Date math.
 */
export interface ReportScope {
  tenantId: string
  accountId: string
}
export interface ReportParams {
  from: string // ISO
  to: string // ISO
  deviceId?: string
  timezone: string // IANA zone (from the account); validated → falls back to UTC
}

export const REPORT_TYPES = ['trips', 'mileage', 'stops', 'overspeed', 'geofence', 'engine_hours'] as const
export type ReportType = (typeof REPORT_TYPES)[number]
export function isReportType(s: string): s is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(s)
}

/** Human labels for a report row's device (E06-1 readability). Joined from `devices` within the
 *  SAME tenant/account the query already scopes by (never a widened scope); LEFT JOIN so a
 *  retired/deleted device still yields its row with null labels. The raw numeric `deviceId` is
 *  always kept alongside so existing keys/links don't break. */
export interface DeviceLabels {
  /** device display name, or null if the device row is gone */
  deviceName: string | null
  /** device plate/registration, or null (column is nullable, and null for a missing device) */
  devicePlate: string | null
}
export interface DailyMileageRow extends DeviceLabels {
  day: string
  deviceId: string
  trips: number
  distanceM: number
}
export interface DailyStopsRow extends DeviceLabels {
  day: string
  deviceId: string
  trips: number
  idleS: number
}
export interface DailyEngineHoursRow extends DeviceLabels {
  day: string
  deviceId: string
  seconds: number
}
export interface DailyOverspeedRow extends DeviceLabels {
  day: string
  deviceId: string
  count: number
  maxSpeedKmh: number | null
}
export interface DailyGeofenceRow extends DeviceLabels {
  day: string
  deviceId: string
  enters: number
  exits: number
}
export interface TripRow extends DeviceLabels {
  id: string
  deviceId: string
  day: string
  startTime: string
  endTime: string | null
  distanceM: number
  distanceSource: string
  maxSpeed: number
  idleS: number
}
export type ReportRow = DailyMileageRow | DailyStopsRow | DailyEngineHoursRow | DailyOverspeedRow | DailyGeofenceRow | TripRow
export interface ReportResult {
  type: ReportType
  rows: ReportRow[]
}

const TRIP_LIST_CAP = 5_000

const INT8_MAX = 9_223_372_036_854_775_807n
/** A device id must be numeric AND fit int8, else binding it as "deviceId" overflows pg (500). */
const validDeviceId = (s: string | undefined): boolean => s !== undefined && /^\d+$/.test(s) && BigInt(s) <= INT8_MAX
/** Trust only a resolvable IANA zone — an unknown zone would make Postgres 500. */
function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

/** Common scaffolding: bound params + WHERE for a tenant/account/time/device-scoped query.
 * `timeCol` is the quoted column the range + device filter apply to. `alias` is the base
 * table's alias (e.g. `t`/`e`) — every scope column is qualified with it so the devices JOIN
 * (which also carries tenantId/accountId/deviceId) never makes a reference ambiguous. */
function scopeWhere(scope: ReportScope, params: ReportParams, timeCol: string, alias: string): { params: unknown[]; where: string; tzIndex: number; toIndex: number | null } {
  const q = `${alias}.`
  const p: unknown[] = [scope.tenantId, scope.accountId]
  const where: string[] = [`${q}"tenantId" = $1`, `${q}"accountId" = $2`]
  // an out-of-range/garbage bound is dropped (never 500s); an absent bound just widens the range
  if (isPgSafeDate(params.from)) where.push(`${timeCol} >= $${p.push(new Date(params.from))}`)
  let toIndex: number | null = null
  if (isPgSafeDate(params.to)) {
    toIndex = p.push(new Date(params.to))
    where.push(`${timeCol} < $${toIndex}`)
  }
  if (validDeviceId(params.deviceId)) where.push(`${q}"deviceId" = $${p.push(params.deviceId)}`)
  const tzIndex = p.push(safeTz(params.timezone))
  return { params: p, where: where.join(' AND '), tzIndex, toIndex }
}

/** LEFT JOIN to devices, scoped to the SAME tenant/account as the base table `alias` (never
 *  widened). Kept as a LEFT JOIN so a row survives even if the device was deleted (null labels). */
const deviceJoin = (alias: string): string => `LEFT JOIN devices d ON d.id = ${alias}."deviceId" AND d."tenantId" = ${alias}."tenantId" AND d."accountId" = ${alias}."accountId"`
/** The device-label projection shared by every report (raw id kept separately by each query). */
const DEVICE_LABELS = 'd.name AS device_name, d.plate AS device_plate'

interface PgDaily {
  day: string
  device_id: string
  device_name: string | null
  device_plate: string | null
  a: string
  b: string
}

export async function runReport(pool: Pool, type: ReportType, scope: ReportScope, params: ReportParams): Promise<ReportResult> {
  switch (type) {
    case 'mileage':
      return { type, rows: await mileage(pool, scope, params) }
    case 'stops':
      return { type, rows: await stops(pool, scope, params) }
    case 'engine_hours':
      return { type, rows: await engineHours(pool, scope, params) }
    case 'overspeed':
      return { type, rows: await overspeed(pool, scope, params) }
    case 'geofence':
      return { type, rows: await geofence(pool, scope, params) }
    case 'trips':
      return { type, rows: await trips(pool, scope, params) }
  }
}

const dayExpr = (col: string, tzIdx: number): string => `to_char(date_trunc('day', ${col} AT TIME ZONE $${tzIdx}), 'YYYY-MM-DD')`

async function mileage(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyMileageRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, 't."startTime"', 't')
  const res = await pool.query<PgDaily>(
    `SELECT ${dayExpr('t."startTime"', tzIndex)} AS day, t."deviceId"::text AS device_id, ${DEVICE_LABELS},
            count(*)::text AS a, coalesce(sum(t."distanceM"),0)::text AS b
     FROM trips t ${deviceJoin('t')} WHERE ${where} GROUP BY 1,2,3,4 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, deviceName: r.device_name, devicePlate: r.device_plate, trips: Number(r.a), distanceM: Number(r.b) }))
}

async function stops(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyStopsRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, 't."startTime"', 't')
  const res = await pool.query<PgDaily>(
    `SELECT ${dayExpr('t."startTime"', tzIndex)} AS day, t."deviceId"::text AS device_id, ${DEVICE_LABELS},
            count(*)::text AS a, coalesce(sum(t."idleS"),0)::text AS b
     FROM trips t ${deviceJoin('t')} WHERE ${where} GROUP BY 1,2,3,4 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, deviceName: r.device_name, devicePlate: r.device_plate, trips: Number(r.a), idleS: Number(r.b) }))
}

async function engineHours(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyEngineHoursRow[]> {
  const { params: p, where, tzIndex, toIndex } = scopeWhere(scope, params, 't."startTime"', 't')
  // an open trip (endTime null) counts to the report's `to` bound if given (so a still-open
  // trip can't inflate a historical window), else to now(); GREATEST(...,0) guards clock skew
  const cap = toIndex !== null ? `LEAST(now(), $${toIndex})` : 'now()'
  const res = await pool.query<{ day: string; device_id: string; device_name: string | null; device_plate: string | null; a: string }>(
    `SELECT ${dayExpr('t."startTime"', tzIndex)} AS day, t."deviceId"::text AS device_id, ${DEVICE_LABELS},
            coalesce(sum(GREATEST(EXTRACT(EPOCH FROM (coalesce(t."endTime", ${cap}) - t."startTime")), 0)),0)::bigint::text AS a
     FROM trips t ${deviceJoin('t')} WHERE ${where} GROUP BY 1,2,3,4 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, deviceName: r.device_name, devicePlate: r.device_plate, seconds: Number(r.a) }))
}

async function overspeed(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyOverspeedRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, 'e."at"', 'e')
  const res = await pool.query<{ day: string; device_id: string; device_name: string | null; device_plate: string | null; a: string; b: string | null }>(
    `SELECT ${dayExpr('e."at"', tzIndex)} AS day, e."deviceId"::text AS device_id, ${DEVICE_LABELS},
            count(*)::text AS a, max((e.payload->>'speedKmh')::float8)::text AS b
     FROM events e ${deviceJoin('e')} WHERE ${where} AND e.kind = 'overspeed' GROUP BY 1,2,3,4 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, deviceName: r.device_name, devicePlate: r.device_plate, count: Number(r.a), maxSpeedKmh: r.b === null ? null : Number(r.b) }))
}

async function geofence(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyGeofenceRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, 'e."at"', 'e')
  const res = await pool.query<{ day: string; device_id: string; device_name: string | null; device_plate: string | null; a: string; b: string }>(
    `SELECT ${dayExpr('e."at"', tzIndex)} AS day, e."deviceId"::text AS device_id, ${DEVICE_LABELS},
            count(*) FILTER (WHERE e.payload->>'transition' = 'enter')::text AS a,
            count(*) FILTER (WHERE e.payload->>'transition' = 'exit')::text AS b
     FROM events e ${deviceJoin('e')} WHERE ${where} AND e.kind = 'geofence' GROUP BY 1,2,3,4 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, deviceName: r.device_name, devicePlate: r.device_plate, enters: Number(r.a), exits: Number(r.b) }))
}

interface PgTrip {
  id: string
  device_id: string
  device_name: string | null
  device_plate: string | null
  day: string
  start_time: Date
  end_time: Date | null
  distance_m: number
  distance_source: string
  max_speed: number
  idle_s: number
}
async function trips(pool: Pool, scope: ReportScope, params: ReportParams): Promise<TripRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, 't."startTime"', 't')
  const res = await pool.query<PgTrip>(
    `SELECT t.id::text, t."deviceId"::text AS device_id, ${DEVICE_LABELS}, ${dayExpr('t."startTime"', tzIndex)} AS day,
            t."startTime" AS start_time, t."endTime" AS end_time, t."distanceM" AS distance_m,
            t."distanceSource" AS distance_source, t."maxSpeed" AS max_speed, t."idleS" AS idle_s
     FROM trips t ${deviceJoin('t')} WHERE ${where} ORDER BY t."startTime" DESC LIMIT ${TRIP_LIST_CAP}`,
    p,
  )
  return res.rows.map((r) => ({
    id: r.id,
    deviceId: r.device_id,
    deviceName: r.device_name,
    devicePlate: r.device_plate,
    day: r.day,
    startTime: r.start_time.toISOString(),
    endTime: r.end_time === null ? null : r.end_time.toISOString(),
    distanceM: r.distance_m,
    distanceSource: r.distance_source,
    maxSpeed: r.max_speed,
    idleS: r.idle_s,
  }))
}
