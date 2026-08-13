import type { Pool } from 'pg'

import type { FuelSampleView } from '@orbetra/shared'

import { isPgSafeDate } from './dateGuard.js'

/**
 * Scoped fuel-series read for the playback fuel graph (E08-3, §4 "fuel level graph where
 * AVL present"). Raw SQL over the pool — positions are NOT in Prisma (rule 1). The CALLER
 * must first prove the device is in the requester's scope (db.devices.get) and pass the
 * validated numeric deviceId, exactly like readPositions.
 *
 * Fuel AVL ids land in attrs under FORCED io_<id> keys (worker normalize, E08-3):
 *   io_89 Fuel level %  ·  io_48 OBD Fuel Level %  ·  io_84 Fuel level l (wiki ×0.1)
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 * Values are stored raw; unit conversion happens HERE. attrs is jsonb from the wire, so
 * values are coerced defensively in JS (a ::numeric cast on garbage would 500).
 */
export interface FuelOpts {
  /** the device profile's AVL table — only AVL 89's scale varies by model (see pctScale) */
  avlTable?: string
  from?: string
  to?: string
  limit?: number
}

const MAX_PAGE = 10_000

const num = (v: string | null): number | null => {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface PgFuelRow {
  fix_time: Date
  pct89: string | null
  pct48: string | null
  l84: string | null
}

/**
 * AVL 89's percentage does NOT carry the same scale on every model.
 *
 * 12 tables document it as a plain percent with no multiplier; `fm36` — FM36, FM3612, FM36M1 —
 * types it "LVCAN Fuel Level (percentage)", 1 byte, 0…255, MULTIPLIER 0.1. It is the only table in
 * the corpus where 89 carries one. Applying the majority scale to an FM3612 turned a half tank
 * (wire 200 = 20.0 %) into `pct: 200`, which the playback badge printed as "200%" — while the
 * litres series on the SAME panel was right, because AVL 84 is ×0.1 on both tables. Same defect
 * class as the FMB930 external-voltage scale in health.ts, same shape of fix.
 */
const pctScale = (avlTable: string | undefined): number => (avlTable === 'fm36' ? 0.1 : 1)

export async function readFuelSeries(pool: Pool, deviceId: bigint, opts: FuelOpts = {}): Promise<FuelSampleView[]> {
  // NOTE: `attrs ?| ...` can't use the (device_id, fix_time) index as a filter, so a call
  // WITHOUT from/to scans the device's whole history before LIMIT applies. Fine at V1 scale
  // (13-month retention, per-device); revisit with a partial index if fuel fleets grow.
  const limit = Math.trunc(Math.min(Math.max(Number.isFinite(opts.limit) ? Number(opts.limit) : MAX_PAGE, 1), MAX_PAGE))
  const params: unknown[] = [deviceId.toString()]
  const where: string[] = ['device_id = $1', `attrs ?| array['io_89','io_48','io_84']`]
  if (isPgSafeDate(opts.from)) where.push(`fix_time >= $${params.push(new Date(opts.from!))}`)
  if (isPgSafeDate(opts.to)) where.push(`fix_time <= $${params.push(new Date(opts.to!))}`)
  const res = await pool.query<PgFuelRow>(
    `SELECT fix_time, attrs->>'io_89' AS pct89, attrs->>'io_48' AS pct48, attrs->>'io_84' AS l84
     FROM positions WHERE ${where.join(' AND ')}
     ORDER BY fix_time ASC, rec_hash ASC LIMIT ${limit}`,
    params,
  )
  const out: FuelSampleView[] = []
  for (const row of res.rows) {
    const pct89 = num(row.pct89)
    const pct = (pct89 === null ? null : pct89 * pctScale(opts.avlTable)) ?? num(row.pct48)
    const l84 = num(row.l84)
    const liters = l84 === null ? null : l84 * 0.1 // AVL 84 multiplier ×0.1 (wiki)
    if (pct === null && liters === null) continue // garbage-only row — skip, never 500
    out.push({ fixTime: row.fix_time.toISOString(), pct, liters })
  }
  return out
}
