import type { Pool } from 'pg'

import type { NormalizedRecord } from '@orbetra/shared'

const COLUMNS = [
  'device_id',
  'fix_time',
  'server_time',
  'lat',
  'lon',
  'altitude',
  'speed',
  'course',
  'satellites',
  'fix_valid',
  'ignition',
  'movement',
  'odometer_m',
  'priority',
  'rec_hash',
  'attrs',
] as const

export const MAX_BATCH_ROWS = 500 // §6.1: 500-row batches

/**
 * Hot-path positions writer (CLAUDE.md rule 1): ONE batched multi-row
 * INSERT … ON CONFLICT (device_id, fix_time, rec_hash) DO NOTHING — invariant I3.
 * COPY is forbidden here (no ON CONFLICT support; ADR-008 gate).
 * Returns the number of rows actually inserted (duplicates excluded).
 */
export async function writePositions(pool: Pool, records: NormalizedRecord[]): Promise<number> {
  let inserted = 0
  for (let off = 0; off < records.length; off += MAX_BATCH_ROWS) {
    const batch = records.slice(off, off + MAX_BATCH_ROWS)
    const params: unknown[] = []
    const tuples = batch.map((r, i) => {
      params.push(
        r.deviceId.toString(),
        r.fixTime,
        r.serverTime,
        r.lat,
        r.lon,
        r.altitude,
        r.speed,
        r.course,
        r.satellites,
        r.fixValid,
        r.ignition,
        r.movement,
        r.odometerM === null ? null : r.odometerM.toString(),
        r.priority,
        r.recHash.toString(),
        JSON.stringify(r.attrs),
      )
      const base = i * COLUMNS.length
      return `(${COLUMNS.map((_, j) => `$${base + j + 1}`).join(',')})`
    })
    const res = await pool.query(
      `INSERT INTO positions (${COLUMNS.join(',')}) VALUES ${tuples.join(',')}
       ON CONFLICT (device_id, fix_time, rec_hash) DO NOTHING`,
      params,
    )
    inserted += res.rowCount ?? 0
  }
  return inserted
}
