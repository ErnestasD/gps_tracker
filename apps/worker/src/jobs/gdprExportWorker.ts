import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip, type Gzip } from 'node:zlib'

import { Worker, type ConnectionOptions } from 'bullmq'
import type { Pool } from 'pg'

import { GDPR_EXPORT_QUEUE, GDPR_SWEEP_QUEUE, type ExportJobData } from './gdprQueue.js'

/**
 * GDPR account data export (E08-4, §6.6 POST /v1/accounts/:id/export). Writes ONE
 * NDJSON.gz file to EXPORT_DIR (each line `{"type":"...","data":{...}}`). Memory stays
 * flat regardless of account size: EVERY unbounded table (positions, trips, events,
 * commands) is keyset-paged, and gzip backpressure is honoured (`write()===false` →
 * await drain) so pg reads can never buffer unboundedly ahead of the disk. Sensitive
 * fields NEVER exported: users.passwordHash, webhooks.secret (api_keys/refresh_tokens
 * are not exported at all). Scope comes from the export_jobs row (the api scope-gated
 * the account at create time); every SELECT filters tenantId+accountId. The file is
 * written to a temp name and renamed on success, so a concurrent download can never see
 * a half-written or truncated file. R2/S3 upload is the documented follow-up.
 */
export interface GdprExportDeps {
  connection: ConnectionOptions
  pool: Pool
  exportDir: string
  onDone?: (r: { exportId: string; bytes: number }) => void
  onFailed?: () => void
  onSwept?: (removed: number) => void
}

const PAGE = 10_000

interface JobRow {
  tenantId: string
  accountId: string
  status: string
}

/** Run one export job to completion. Throws on failure (BullMQ retries, bounded). */
export async function runExport(pool: Pool, exportDir: string, exportId: string): Promise<{ exportId: string; bytes: number }> {
  const jobRes = await pool.query<JobRow>(`SELECT "tenantId", "accountId", status FROM export_jobs WHERE id = $1`, [exportId])
  if (jobRes.rowCount === 0) throw new Error(`export job ${exportId} not found`)
  const { tenantId, accountId } = jobRes.rows[0]!

  await mkdir(exportDir, { recursive: true })
  const finalPath = path.join(exportDir, `${exportId}.ndjson.gz`)
  // UNIQUE tmp per attempt (review LOW): a stalled duplicate attempt sharing the tmp
  // name would keep writing into the published file's inode after the winner's rename
  const tmpPath = `${finalPath}.${randomUUID()}.tmp`
  const gzip = createGzip()
  const sink = createWriteStream(tmpPath)
  const done = pipeline(gzip, sink) // resolves when the file is fully flushed

  const write = async (g: Gzip, type: string, data: unknown): Promise<void> => {
    // honour backpressure: a false return means the gzip buffer is full — wait for drain
    if (!g.write(JSON.stringify({ type, data }) + '\n')) await once(g, 'drain')
  }

  try {
    const scoped = async (type: string, sql: string): Promise<void> => {
      const res = await pool.query(sql, [tenantId, accountId])
      for (const row of res.rows) await write(gzip, type, row)
    }
    /** keyset-page an unbounded table by a bigint/uuid-sortable id column. */
    const scopedPaged = async (type: string, table: string, idExpr: string, columns: string): Promise<void> => {
      let after: string | null = null
      for (;;) {
        const params: unknown[] = [tenantId, accountId]
        let cursor = ''
        if (after !== null) cursor = ` AND ${idExpr} > $${params.push(after)}`
        const res: { rows: (Record<string, unknown> & { __cursor: string })[] } = await pool.query(
          `SELECT ${columns}, ${idExpr} AS __cursor FROM ${table} WHERE "tenantId" = $1 AND "accountId" = $2${cursor} ORDER BY ${idExpr} ASC LIMIT ${PAGE}`,
          params,
        )
        for (const full of res.rows) {
          const { __cursor: _drop, ...row } = full
          void _drop
          await write(gzip, type, row)
        }
        if (res.rows.length < PAGE) return
        after = res.rows[res.rows.length - 1]!.__cursor
      }
    }

    await write(gzip, 'meta', { exportId, tenantId, accountId, format: 'orbetra-gdpr-ndjson-v1' })
    await scoped('account', `SELECT id, name, timezone, "createdAt" FROM accounts WHERE "tenantId" = $1 AND id = $2`)
    // NO passwordHash — the single most dangerous column in the schema
    await scoped('user', `SELECT id, email, role, locale, "createdAt" FROM users WHERE "tenantId" = $1 AND "accountId" = $2`)
    await scoped('device', `SELECT id::text, imei, name, plate, "groupName", "odometerSource", "retiredAt", "createdAt" FROM devices WHERE "tenantId" = $1 AND "accountId" = $2`)
    await scopedPaged('trip', 'trips', 'id',
      `id::text, "deviceId"::text, status, "startTime", "endTime", "startLat", "startLon", "endLat", "endLon", "distanceM", "distanceSource", "maxSpeed", "idleS"`)
    await scopedPaged('event', 'events', 'id',
      `id::text, "deviceId"::text, "ruleId", kind, at, lat, lon, payload, "acknowledgedAt"`)
    await scopedPaged('command', 'commands', 'id::text',
      `id, "deviceId"::text, text, status, response, "createdAt", "sentAt"`)
    await scoped('geofence', `SELECT id, name, color, kind, ST_AsGeoJSON(geom::geometry) AS geometry, "createdAt" FROM geofences WHERE "tenantId" = $1 AND "accountId" = $2`)
    await scoped('rule', `SELECT id, kind, name, config, scope, "cooldownS", enabled, "createdAt" FROM rules WHERE "tenantId" = $1 AND "accountId" = $2`)
    // NO secret
    await scoped('webhook', `SELECT id, url, events, enabled, "createdAt" FROM webhooks WHERE "tenantId" = $1 AND "accountId" = $2`)

    // positions per device, keyset-paged on the PK order
    const devices = await pool.query<{ id: string }>(`SELECT id::text FROM devices WHERE "tenantId" = $1 AND "accountId" = $2`, [tenantId, accountId])
    for (const d of devices.rows) {
      let after: { t: Date; h: string } | null = null
      for (;;) {
        const params: unknown[] = [d.id]
        let where = 'device_id = $1'
        if (after !== null) {
          params.push(after.t, after.h)
          where += ` AND (fix_time, rec_hash) > ($2, $3)`
        }
        const page = await pool.query<{ fix_time: Date; lat: number; lon: number; speed: number | null; course: number | null; ignition: boolean | null; fix_valid: boolean; odometer_m: string | null; attrs: unknown; rec_hash: string }>(
          `SELECT fix_time, lat, lon, speed, course, ignition, fix_valid, odometer_m, attrs, rec_hash
           FROM positions WHERE ${where} ORDER BY fix_time ASC, rec_hash ASC LIMIT ${PAGE}`,
          params,
        )
        for (const p of page.rows) await write(gzip, 'position', { deviceId: d.id, ...p })
        if (page.rows.length < PAGE) break
        const last = page.rows[page.rows.length - 1]!
        after = { t: last.fix_time, h: last.rec_hash }
      }
    }

    gzip.end()
    await done
  } catch (err) {
    // tear the pipeline down and drop the partial temp file — never leak an fd or a
    // half-written personal-data dump (review MED-4)
    gzip.destroy()
    sink.destroy()
    await unlink(tmpPath).catch(() => undefined)
    throw err
  }

  await rename(tmpPath, finalPath) // atomic publish — downloads never see a partial file
  const bytes = (await stat(finalPath)).size
  // guard `status <> 'done'` (review LOW-5): if a stalled earlier attempt somehow lost the
  // race, the winner's file + size stay authoritative
  await pool.query(`UPDATE export_jobs SET status = 'done', path = $2, "sizeBytes" = $3 WHERE id = $1 AND status <> 'done'`, [exportId, finalPath, bytes])
  return { exportId, bytes }
}

/** Delete expired export files + mark their rows (repeatable sweep; the DURABLE half of
 * MED-3 — the download route's lazy unlink only fires when someone hits an expired link). */
export async function runExportSweep(pool: Pool): Promise<number> {
  const expired = await pool.query<{ id: string; path: string | null }>(
    `SELECT id, path FROM export_jobs WHERE status = 'done' AND "expiresAt" < now()`,
  )
  let removed = 0
  for (const row of expired.rows) {
    if (row.path !== null) await unlink(row.path).catch(() => undefined) // already-gone file is fine
    await pool.query(`UPDATE export_jobs SET status = 'expired', path = NULL WHERE id = $1 AND status = 'done'`, [row.id])
    removed++
  }
  return removed
}

export const EXPORT_SWEEP_EVERY_MS = 60 * 60_000

/** Repeatable sweep consumer — removes expired export files hourly. */
export function startGdprSweepWorker(deps: Pick<GdprExportDeps, 'connection' | 'pool' | 'onSwept'>): Worker {
  return new Worker(
    GDPR_SWEEP_QUEUE,
    async () => {
      const removed = await runExportSweep(deps.pool)
      if (removed > 0) deps.onSwept?.(removed)
    },
    { connection: deps.connection, concurrency: 1 },
  )
}

export function startGdprExportWorker(deps: GdprExportDeps): Worker<ExportJobData> {
  return new Worker<ExportJobData>(
    GDPR_EXPORT_QUEUE,
    async (job) => {
      try {
        const r = await runExport(deps.pool, deps.exportDir, job.data.exportId)
        deps.onDone?.(r)
      } catch (err) {
        deps.onFailed?.()
        const msg = err instanceof Error ? err.message.slice(0, 500) : 'export failed'
        // best-effort status write; rethrow so BullMQ retries (bounded) — a later success overwrites
        await deps.pool.query(`UPDATE export_jobs SET status = 'failed', error = $2 WHERE id = $1 AND status <> 'done'`, [job.data.exportId, msg]).catch(() => undefined)
        throw err
      }
    },
    { connection: deps.connection, concurrency: 1 },
  )
}
