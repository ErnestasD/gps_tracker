import type { Pool } from 'pg'

import type { HealthSampleView } from '@orbetra/shared'

/**
 * Scoped device-health series (V1-nice: the "#1 TSP support-call deflector"). Raw SQL over
 * positions (rule 1) — the CALLER scope-gates the device (like readFuelSeries). All fields
 * already flow through the pipeline into attrs (wiki FMB120 params):
 *   GSM Signal (AVL 21, 0–5) · External Voltage (AVL 66, V ×0.001) · Battery Voltage (AVL 67, V ×0.001)
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 * normalize() stores these under the dictionary NAME, falling back to io_<id> on a
 * name collision, so the reader coalesces both. Voltages are raw mV — scaled to V here.
 * jsonb values are coerced defensively in JS (a ::numeric cast on garbage would 500).
 */
export interface HealthOpts {
  from?: string
  to?: string
  limit?: number
}

const MAX_PAGE = 10_000
const MIN_MS = Date.parse('0001-01-01T00:00:00Z')
const MAX_MS = Date.parse('9999-12-31T23:59:59Z')
const validDate = (s: string | undefined): boolean => {
  if (s === undefined) return false
  const t = new Date(s).getTime()
  return !Number.isNaN(t) && t >= MIN_MS && t <= MAX_MS
}
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
  if (validDate(opts.from)) where.push(`fix_time >= $${params.push(new Date(opts.from!))}`)
  if (validDate(opts.to)) where.push(`fix_time <= $${params.push(new Date(opts.to!))}`)
  const res = await pool.query<PgHealthRow>(
    `SELECT fix_time,
            COALESCE(attrs->>'GSM Signal', attrs->>'io_21') AS gsm,
            COALESCE(attrs->>'External Voltage', attrs->>'io_66') AS ext_mv,
            COALESCE(attrs->>'Battery Voltage', attrs->>'io_67') AS bat_mv
     FROM positions WHERE ${where.join(' AND ')}
     ORDER BY fix_time ASC, rec_hash ASC LIMIT ${limit}`,
    params,
  )
  const out: HealthSampleView[] = []
  for (const r of res.rows) {
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
