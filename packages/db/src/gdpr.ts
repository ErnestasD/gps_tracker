import type { Pool } from 'pg'

/**
 * GDPR device-erase support (E08-4): delete a device's positions from the hypertable in
 * bounded TIME WINDOWS (30 d), oldest first — one giant DELETE over a year of data would be
 * a single huge transaction across many chunks. Raw SQL territory (rule 1). The CALLER
 * (worker erase job) must already have proven tenant scope via the device row.
 *
 * Compressed chunks: the pinned TimescaleDB image supports DML on compressed chunks the
 * same way the R8-2 insert test proved; if a future version refuses DELETE on a compressed
 * chunk this loop is the single place to add decompress_chunk() (documented in the plan).
 */
const WINDOW_MS = 30 * 24 * 3_600_000

export async function erasePositions(pool: Pool, deviceId: bigint): Promise<number> {
  const id = deviceId.toString()
  let total = 0
  for (;;) {
    const min = await pool.query<{ t: Date | null }>(`SELECT min(fix_time) AS t FROM positions WHERE device_id = $1`, [id])
    const t = min.rows[0]?.t ?? null
    if (t === null) return total // nothing left
    const upTo = new Date(t.getTime() + WINDOW_MS)
    const res = await pool.query(`DELETE FROM positions WHERE device_id = $1 AND fix_time < $2`, [id, upTo])
    total += res.rowCount ?? 0
  }
}
