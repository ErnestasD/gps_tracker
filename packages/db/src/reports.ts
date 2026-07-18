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

export interface DailyMileageRow {
  day: string
  deviceId: string
  trips: number
  distanceM: number
}
export interface DailyStopsRow {
  day: string
  deviceId: string
  trips: number
  idleS: number
}
export interface DailyEngineHoursRow {
  day: string
  deviceId: string
  seconds: number
}
export interface DailyOverspeedRow {
  day: string
  deviceId: string
  count: number
  maxSpeedKmh: number | null
}
export interface DailyGeofenceRow {
  day: string
  deviceId: string
  enters: number
  exits: number
}
export interface TripRow {
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
 * `timeCol` is the quoted column the range + device filter apply to. */
function scopeWhere(scope: ReportScope, params: ReportParams, timeCol: string): { params: unknown[]; where: string; tzIndex: number; toIndex: number | null } {
  const p: unknown[] = [scope.tenantId, scope.accountId]
  const where: string[] = ['"tenantId" = $1', '"accountId" = $2']
  // an out-of-range/garbage bound is dropped (never 500s); an absent bound just widens the range
  if (isPgSafeDate(params.from)) where.push(`${timeCol} >= $${p.push(new Date(params.from))}`)
  let toIndex: number | null = null
  if (isPgSafeDate(params.to)) {
    toIndex = p.push(new Date(params.to))
    where.push(`${timeCol} < $${toIndex}`)
  }
  if (validDeviceId(params.deviceId)) where.push(`"deviceId" = $${p.push(params.deviceId)}`)
  const tzIndex = p.push(safeTz(params.timezone))
  return { params: p, where: where.join(' AND '), tzIndex, toIndex }
}

interface PgDaily {
  day: string
  device_id: string
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
  const { params: p, where, tzIndex } = scopeWhere(scope, params, '"startTime"')
  const res = await pool.query<PgDaily>(
    `SELECT ${dayExpr('"startTime"', tzIndex)} AS day, "deviceId"::text AS device_id,
            count(*)::text AS a, coalesce(sum("distanceM"),0)::text AS b
     FROM trips WHERE ${where} GROUP BY 1,2 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, trips: Number(r.a), distanceM: Number(r.b) }))
}

async function stops(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyStopsRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, '"startTime"')
  const res = await pool.query<PgDaily>(
    `SELECT ${dayExpr('"startTime"', tzIndex)} AS day, "deviceId"::text AS device_id,
            count(*)::text AS a, coalesce(sum("idleS"),0)::text AS b
     FROM trips WHERE ${where} GROUP BY 1,2 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, trips: Number(r.a), idleS: Number(r.b) }))
}

async function engineHours(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyEngineHoursRow[]> {
  const { params: p, where, tzIndex, toIndex } = scopeWhere(scope, params, '"startTime"')
  // an open trip (endTime null) counts to the report's `to` bound if given (so a still-open
  // trip can't inflate a historical window), else to now(); GREATEST(...,0) guards clock skew
  const cap = toIndex !== null ? `LEAST(now(), $${toIndex})` : 'now()'
  const res = await pool.query<{ day: string; device_id: string; a: string }>(
    `SELECT ${dayExpr('"startTime"', tzIndex)} AS day, "deviceId"::text AS device_id,
            coalesce(sum(GREATEST(EXTRACT(EPOCH FROM (coalesce("endTime", ${cap}) - "startTime")), 0)),0)::bigint::text AS a
     FROM trips WHERE ${where} GROUP BY 1,2 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, seconds: Number(r.a) }))
}

async function overspeed(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyOverspeedRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, '"at"')
  const res = await pool.query<{ day: string; device_id: string; a: string; b: string | null }>(
    `SELECT ${dayExpr('"at"', tzIndex)} AS day, "deviceId"::text AS device_id,
            count(*)::text AS a, max((payload->>'speedKmh')::float8)::text AS b
     FROM events WHERE ${where} AND kind = 'overspeed' GROUP BY 1,2 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, count: Number(r.a), maxSpeedKmh: r.b === null ? null : Number(r.b) }))
}

async function geofence(pool: Pool, scope: ReportScope, params: ReportParams): Promise<DailyGeofenceRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, '"at"')
  const res = await pool.query<{ day: string; device_id: string; a: string; b: string }>(
    `SELECT ${dayExpr('"at"', tzIndex)} AS day, "deviceId"::text AS device_id,
            count(*) FILTER (WHERE payload->>'transition' = 'enter')::text AS a,
            count(*) FILTER (WHERE payload->>'transition' = 'exit')::text AS b
     FROM events WHERE ${where} AND kind = 'geofence' GROUP BY 1,2 ORDER BY 1,2`,
    p,
  )
  return res.rows.map((r) => ({ day: r.day, deviceId: r.device_id, enters: Number(r.a), exits: Number(r.b) }))
}

interface PgTrip {
  id: string
  device_id: string
  day: string
  start_time: Date
  end_time: Date | null
  distance_m: number
  distance_source: string
  max_speed: number
  idle_s: number
}
async function trips(pool: Pool, scope: ReportScope, params: ReportParams): Promise<TripRow[]> {
  const { params: p, where, tzIndex } = scopeWhere(scope, params, '"startTime"')
  const res = await pool.query<PgTrip>(
    `SELECT id::text, "deviceId"::text AS device_id, ${dayExpr('"startTime"', tzIndex)} AS day,
            "startTime" AS start_time, "endTime" AS end_time, "distanceM" AS distance_m,
            "distanceSource" AS distance_source, "maxSpeed" AS max_speed, "idleS" AS idle_s
     FROM trips WHERE ${where} ORDER BY "startTime" DESC LIMIT ${TRIP_LIST_CAP}`,
    p,
  )
  return res.rows.map((r) => ({
    id: r.id,
    deviceId: r.device_id,
    day: r.day,
    startTime: r.start_time.toISOString(),
    endTime: r.end_time === null ? null : r.end_time.toISOString(),
    distanceM: r.distance_m,
    distanceSource: r.distance_source,
    maxSpeed: r.max_speed,
    idleS: r.idle_s,
  }))
}
