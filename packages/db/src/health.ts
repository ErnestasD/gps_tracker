import type { Pool } from 'pg'

import type { HealthSampleView } from '@orbetra/shared'

import { isPgSafeDate } from './dateGuard.js'

/**
 * Scoped device-health series (V1-nice: the "#1 TSP support-call deflector"). Raw SQL over
 * positions (rule 1) — the CALLER scope-gates the device (like readFuelSeries). All fields
 * already flow through the pipeline into attrs (wiki FMB120 params):
 *   GSM Signal (AVL 21, 1–5) · External Voltage (AVL 66, V ×0.001) · Battery Voltage (AVL 67, V ×0.001)
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 * normalize() stores these under the dictionary NAME, falling back to io_<id> on a
 * name collision, so the reader coalesces both. Voltages are raw mV — scaled to V here.
 * (AVL 168 is ALSO named "Battery Voltage" but is likewise mV, so ×0.001 holds whichever
 * key wins the collision.) jsonb values are coerced defensively in JS (a ::numeric cast on
 * garbage would 500).
 *
 * Rows are selected NEWEST-first (DESC + LIMIT) then reversed to ascending for the chart, so
 * with no from/to the window is the most-recent `limit` samples — NOT the earliest. The API
 * derives the "latest"/"last seen" headline from the tail of this series; an ASC+LIMIT scan
 * would pin the headline to the ~10 000th-OLDEST sample once a device exceeds `limit` points.
 */
export interface HealthOpts {
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

interface PgHealthRow {
  fix_time: Date
  gsm: string | null
  ext_mv: string | null
  bat_mv: string | null
}

export async function readHealthSeries(pool: Pool, deviceId: bigint, opts: HealthOpts = {}): Promise<HealthSampleView[]> {
  const limit = Math.trunc(Math.min(Math.max(Number.isFinite(opts.limit) ? Number(opts.limit) : MAX_PAGE, 1), MAX_PAGE))
  const params: unknown[] = [deviceId.toString()]
  const where: string[] = ['device_id = $1']
  if (isPgSafeDate(opts.from)) where.push(`fix_time >= $${params.push(new Date(opts.from!))}`)
  if (isPgSafeDate(opts.to)) where.push(`fix_time <= $${params.push(new Date(opts.to!))}`)
  const res = await pool.query<PgHealthRow>(
    `SELECT fix_time,
            COALESCE(attrs->>'GSM Signal', attrs->>'io_21') AS gsm,
            COALESCE(attrs->>'External Voltage', attrs->>'io_66') AS ext_mv,
            COALESCE(attrs->>'Battery Voltage', attrs->>'io_67') AS bat_mv
     FROM positions WHERE ${where.join(' AND ')}
     ORDER BY fix_time DESC, rec_hash DESC LIMIT ${limit}`,
    params,
  )
  const out: HealthSampleView[] = []
  // DESC-selected newest rows → reverse to ascending so the chart reads left-to-right and
  // the caller's series[last] is the genuinely-newest sample (see header note).
  for (const r of res.rows.reverse()) {
    const gsm = num(r.gsm)
    const extMv = num(r.ext_mv)
    const batMv = num(r.bat_mv)
    if (gsm === null && extMv === null && batMv === null) continue
    out.push({
      fixTime: r.fix_time.toISOString(),
      gsm,
      extV: extMv === null ? null : extMv * 0.001, // AVL 66 multiplier (wiki)
      battV: batMv === null ? null : batMv * 0.001, // AVL 67 multiplier (wiki)
    })
  }
  return out
}
