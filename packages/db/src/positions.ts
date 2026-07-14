import type { Pool } from 'pg'

import type { PositionView } from '@orbetra/shared'

import { toInt8OrNull } from './bigid.js'

/**
 * Scoped positions history read (E04-3, §6.6). Raw SQL over the pool — positions are
 * NOT in Prisma (rule 1). The CALLER must first prove the device is in the requester's
 * tenant/account scope (db.devices.get) and pass the validated numeric deviceId; this
 * function never sees a tenant and must not be reached with an unscoped id.
 *
 * Chronological (fixTime ASC) for playback. Keyset cursor on the PK order
 * (fix_time, rec_hash) — stable across the compound PK; `limit` is clamped to the
 * §6.6 10k page cap. All external params are sanitized so garbage never 500s.
 */
export interface PositionsOpts {
  from?: string
  to?: string
  cursor?: string // "<fixTimeMs>_<recHash>"
  limit?: number
}

const MAX_PAGE = 10_000
// Postgres timestamptz range is 4713 BC … 294276 AD; JS Date spans far wider, so a
// JS-valid date can still overflow pg (a 500). Keep bounds well inside both.
const MIN_MS = Date.parse('0001-01-01T00:00:00Z')
const MAX_MS = Date.parse('9999-12-31T23:59:59Z')
const validDate = (s: string | undefined): boolean => {
  if (s === undefined) return false
  const t = new Date(s).getTime()
  return !Number.isNaN(t) && t >= MIN_MS && t <= MAX_MS
}
/** cursor is "<fixTimeMs>_<recHash>"; recHash is a SIGNED int8. Reject anything that
 *  would overflow a pg timestamp/bigint (review MED-1) → treat as no cursor. */
function parseCursor(c: string | undefined): { time: Date; hash: bigint } | null {
  if (c === undefined) return null
  const i = c.indexOf('_')
  if (i <= 0) return null
  const ms = Number(c.slice(0, i))
  const hash = toInt8OrNull(c.slice(i + 1), true)
  if (!/^\d+$/.test(c.slice(0, i)) || !Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS || hash === null) return null
  return { time: new Date(ms), hash }
}

interface PgPositionRow {
  fix_time: Date
  lat: number
  lon: number
  speed: number | null
  course: number | null
  ignition: boolean | null
  fix_valid: boolean
  odometer_m: string | null // bigint → string
  rec_hash: string // bigint → string
}

export async function readPositions(pool: Pool, deviceId: bigint, opts: PositionsOpts = {}): Promise<PositionView[]> {
  const limit = Math.min(Math.max(Number.isFinite(opts.limit) ? Number(opts.limit) : MAX_PAGE, 1), MAX_PAGE)
  const params: unknown[] = [deviceId.toString()]
  const where: string[] = ['device_id = $1']
  if (validDate(opts.from)) where.push(`fix_time >= $${params.push(new Date(opts.from!))}`)
  if (validDate(opts.to)) where.push(`fix_time <= $${params.push(new Date(opts.to!))}`)
  const cur = parseCursor(opts.cursor)
  if (cur !== null) {
    const t = params.push(cur.time)
    const h = params.push(cur.hash.toString())
    where.push(`(fix_time, rec_hash) > ($${t}, $${h})`)
  }
  const res = await pool.query<PgPositionRow>(
    `SELECT fix_time, lat, lon, speed, course, ignition, fix_valid, odometer_m, rec_hash
     FROM positions WHERE ${where.join(' AND ')}
     ORDER BY fix_time ASC, rec_hash ASC LIMIT ${limit}`,
    params,
  )
  // pg returns bigint columns (odometer_m, rec_hash) as strings already
  return res.rows.map((row) => ({
    fixTime: row.fix_time.toISOString(),
    lat: row.lat,
    lon: row.lon,
    speed: row.speed,
    course: row.course,
    ignition: row.ignition,
    fixValid: row.fix_valid,
    odometerM: row.odometer_m,
    recHash: row.rec_hash,
  }))
}

/**
 * Current odometer (km) per device — max(odometer_m)/1000 over positions (odometer is monotonic,
 * so max = current; robust to out-of-order rows). Used by the V2 maintenance due computation.
 * Returns a Map keyed by deviceId STRING; a device with no odometer reports is simply absent.
 * Batched (one query over the id list) so a maintenance list of N devices is a single round-trip.
 */
export async function readOdometersKm(pool: Pool, deviceIds: bigint[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (deviceIds.length === 0) return out
  const res = await pool.query<{ device_id: string; odo_m: string | null }>(
    `SELECT device_id, max(odometer_m) AS odo_m FROM positions WHERE device_id = ANY($1::int8[]) GROUP BY device_id`,
    [deviceIds.map((d) => d.toString())],
  )
  for (const r of res.rows) {
    const m = r.odo_m === null ? null : Number(r.odo_m)
    if (m !== null && Number.isFinite(m)) out.set(r.device_id, m / 1000)
  }
  return out
}

/**
 * The single NEWEST valid-fix position for a device — the live point a public share link shows.
 * Rule 6: `fix_valid=false` (satellites==0) rows are excluded, so a share never advertises a
 * bogus (0,0)-ish location. Caller resolves the device from the share token (unscoped by design,
 * bounded to that one device); this reads by the validated numeric id only.
 */
export async function readLatestValidPosition(pool: Pool, deviceId: bigint): Promise<PositionView | null> {
  const res = await pool.query<PgPositionRow>(
    `SELECT fix_time, lat, lon, speed, course, ignition, fix_valid, odometer_m, rec_hash
     FROM positions WHERE device_id = $1 AND fix_valid = true
     ORDER BY fix_time DESC, rec_hash DESC LIMIT 1`,
    [deviceId.toString()],
  )
  const row = res.rows[0]
  if (row === undefined) return null
  return {
    fixTime: row.fix_time.toISOString(),
    lat: row.lat,
    lon: row.lon,
    speed: row.speed,
    course: row.course,
    ignition: row.ignition,
    fixValid: row.fix_valid,
    odometerM: row.odometer_m,
    recHash: row.rec_hash,
  }
}
