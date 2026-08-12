import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
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
  /** Abandoned `.tmp` exports reaped — a personal-data dump left by a killed process, NOT a routine
   *  expiry. Anything above zero means we are leaking one on every deploy. */
  onOrphanTmp?: (removed: number) => void
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
  const { tenantId, accountId, status } = jobRes.rows[0]!
  // A job that already reached a TERMINAL state is not re-run. The status was read and discarded,
  // so a stalled re-delivery re-read the whole account, gzipped it and renamed over the published
  // file — wasted work whose only visible trace was a `sizeBytes` that no longer matched. For an
  // 'expired' row it was worse: the erase had just removed the dump, and the re-delivery put a
  // fresh copy of the erased account's data back on the volume.
  if (status === 'done' || status === 'expired') return { exportId, bytes: 0 }

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

    await write(gzip, 'meta', { exportId, tenantId, accountId, format: 'gdpr-ndjson-v1' })
    await scoped('account', `SELECT id, name, timezone, "createdAt" FROM accounts WHERE "tenantId" = $1 AND id = $2`)
    // NO passwordHash — the single most dangerous column in the schema
    await scoped('user', `SELECT id, email, role, locale, "createdAt" FROM users WHERE "tenantId" = $1 AND "accountId" = $2`)
    await scoped('device', `SELECT id::text, imei, name, plate, "groupName", "odometerSource", "retiredAt", "createdAt" FROM devices WHERE "tenantId" = $1 AND "accountId" = $2`)
    // drivers, and `trip.driverId` — both added after this export shipped and never folded in
    // (audit MED). A driver row is personal data about a NAMED individual (licence number, phone,
    // iButton) and a subject-access request that omits it is not complete; and without the trip's
    // driverId the export cannot answer "which journeys were attributed to me", which is the
    // question a driver actually asks.
    await scoped('driver', `SELECT id, name, "licenseNo", ibutton, phone, notes, active, "createdAt" FROM drivers WHERE "tenantId" = $1 AND "accountId" = $2`)
    await scopedPaged('trip', 'trips', 'id',
      `id::text, "deviceId"::text, "driverId", status, "startTime", "endTime", "startLat", "startLon", "endLat", "endLon", "distanceM", "distanceSource", "maxSpeed", "idleS"`)
    await scopedPaged('event', 'events', 'id',
      `id::text, "deviceId"::text, "ruleId", kind, at, lat, lon, payload, "acknowledgedAt"`)
    await scopedPaged('command', 'commands', 'id::text',
      `id, "deviceId"::text, text, status, response, "createdAt", "sentAt"`)
    await scoped('geofence', `SELECT id, name, color, kind, ST_AsGeoJSON(geom::geometry) AS geometry, "createdAt" FROM geofences WHERE "tenantId" = $1 AND "accountId" = $2`)
    await scoped('rule', `SELECT id, kind, name, config, scope, "cooldownS", enabled, "createdAt" FROM rules WHERE "tenantId" = $1 AND "accountId" = $2`)
    // NO secret
    await scoped('webhook', `SELECT id, url, events, enabled, "createdAt" FROM webhooks WHERE "tenantId" = $1 AND "accountId" = $2`)
    // config SMS carries a phone number and the message body — personal data by any reading, and
    // the table postdates this export too
    await scopedPaged('sms_delivery', 'sms_deliveries', 'id::text',
      `id, "deviceId"::text, "to", body, provider, status, error, "createdAt", "sentAt"`)
    // recipients[] is a list of named individuals' e-mail addresses; the API already treats it as
    // sensitive (read gated to account writers) and the table postdates this export
    await scoped('scheduled_report', `SELECT id, "reportType", cadence, "hourUtc", weekday, recipients, timezone, enabled, "lastRunAt", "createdAt" FROM scheduled_reports WHERE "tenantId" = $1 AND "accountId" = $2`)
    // endpoint identifies one person's browser. p256dh/auth are CREDENTIALS for pushing to it and
    // are deliberately omitted — an export is a copy of someone's data, not a way to hand an
    // attacker the ability to impersonate a push sender.
    await scoped('push_subscription', `SELECT id, "userId", endpoint, "createdAt" FROM push_subscriptions WHERE "tenantId" = $1 AND "accountId" = $2`)

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
  // `status = 'pending'`, not `<> 'done'`: a GDPR erase running concurrently marks this row
  // 'expired' precisely so the dump stops being downloadable, and `<> 'done'` would flip it straight
  // back with a fresh path — publishing the erased device's data after the erase completed.
  // `IN ('pending','failed')`, not `= 'pending'`. A failed attempt parks the row at 'failed' before
  // rethrowing (see the worker's catch, which says "a later success overwrites" — with `= 'pending'`
  // it did not), and the queue retries 3×. So attempt 2 published the file, matched no row, and then
  // the unlink below removed it while `onDone` reported success: a subject-access request failing
  // silently against a green metric, on a one-month statutory clock. 'done' and 'expired' stay
  // excluded, which is the property the guard is actually for.
  const published = await pool.query(`UPDATE export_jobs SET status = 'done', path = $2, "sizeBytes" = $3 WHERE id = $1 AND status IN ('pending','failed')`, [exportId, finalPath, bytes])
  // …and if the row moved out from under us, the FILE has to go with it. The erase deliberately
  // expires 'pending' rows (a large account's export can be minutes in flight), which leaves the
  // row saying erased and `path` NULL while this rename has just published a personal-data dump on
  // a NAMED docker volume that survives restarts. Nothing else would ever collect it: the sweep
  // only looks at 'done' rows with a path, and the tmp sweeper only at `*.tmp`. Nobody can download
  // it — the route 410s on 'expired' before touching a path — so this is a retention failure rather
  // than an exposure, which is exactly the kind that is never noticed until an audit asks.
  if (published.rowCount === 0) {
    // …but ONLY when nothing points at this file. `rowCount === 0` has two causes and they need
    // opposite handling: the erase expired the row (delete the dump), or a stalled BullMQ
    // re-delivery lost the race to an attempt that already finished (KEEP the dump — the row says
    // 'done' and references this exact path). `finalPath` is deterministic while `tmpPath` is
    // per-attempt, precisely because this worker assumes duplicate attempts exist, so an unlink
    // here without the check turns a healthy export into a permanent 410 for the customer.
    const claimed = await pool.query(`SELECT 1 FROM export_jobs WHERE id = $1 AND status = 'done' AND path = $2`, [exportId, finalPath])
    if (claimed.rowCount === 0) {
      await unlink(finalPath).catch((e: unknown) => console.error('gdpr export: could not remove a dump whose row was expired mid-flight', { exportId, finalPath }, e))
    }
  }
  return { exportId, bytes }
}

/** Delete expired export files + mark their rows (repeatable sweep; the DURABLE half of
 * MED-3 — the download route's lazy unlink only fires when someone hits an expired link). */
export async function runExportSweep(
  pool: Pool,
  exportDir?: string,
  nowMs = Date.now(),
  onOrphan?: (n: number) => void,
): Promise<number> {
  const expired = await pool.query<{ id: string; path: string | null }>(
    `SELECT id, path FROM export_jobs WHERE status = 'done' AND "expiresAt" < now()`,
  )
  let removed = 0
  for (const row of expired.rows) {
    if (row.path !== null) await unlink(row.path).catch(() => undefined) // already-gone file is fine
    await pool.query(`UPDATE export_jobs SET status = 'expired', path = NULL WHERE id = $1 AND status = 'done'`, [row.id])
    removed++
  }
  if (exportDir !== undefined) {
    // reported SEPARATELY: an abandoned personal-data dump being reaped is not a routine expiry,
    // and folding it into one number means "we leak a dump on every deploy" reads as normal traffic
    const orphans = await sweepOrphanTmp(exportDir, nowMs)
    if (orphans > 0) onOrphan?.(orphans)
    removed += orphans
  }
  return removed
}

/**
 * Ceiling on how long a `.tmp` can plausibly still be written. An export of the largest account this
 * product sells is minutes, not hours; anything older than this belongs to a process that is gone.
 */
const TMP_ORPHAN_MS = 6 * 3_600_000

/**
 * Remove abandoned `.tmp` exports (audit MED).
 *
 * The publish is write-to-temp-then-rename, and the failure path unlinks — but only when the code
 * reaches it. A SIGKILL, an OOM, or a deploy landing mid-export skips every `catch` and `finally`,
 * and the row never reaches `done`, so the expiry sweep above never looks at it. What is left on
 * the shared volume is a complete personal-data dump of one account — positions, drivers, phone
 * numbers — with no owner, no expiry, and nothing that would ever delete it. Every restart during
 * an export left another one.
 *
 * Age-gated rather than pattern-only: a `.tmp` being written RIGHT NOW by a live job looks exactly
 * like an abandoned one, and deleting it would fail an export that was going to succeed.
 */
export async function sweepOrphanTmp(exportDir: string, nowMs = Date.now()): Promise<number> {
  let names: string[]
  try {
    names = await readdir(exportDir)
  } catch {
    return 0 // directory not created yet (no export has ever run) — nothing to sweep
  }
  let removed = 0
  for (const name of names) {
    if (!name.endsWith('.tmp')) continue
    const full = path.join(exportDir, name)
    try {
      const st = await stat(full)
      if (nowMs - st.mtimeMs < TMP_ORPHAN_MS) continue
      await unlink(full)
      removed++
    } catch {
      // vanished between readdir and stat/unlink, or not ours to remove — either way, move on
    }
  }
  return removed
}

export const EXPORT_SWEEP_EVERY_MS = 60 * 60_000

/** Repeatable sweep consumer — removes expired export files hourly. */
export function startGdprSweepWorker(deps: Pick<GdprExportDeps, 'connection' | 'pool' | 'exportDir' | 'onSwept' | 'onOrphanTmp'>): Worker {
  return new Worker(
    GDPR_SWEEP_QUEUE,
    async () => {
      const removed = await runExportSweep(deps.pool, deps.exportDir, Date.now(), (n) => deps.onOrphanTmp?.(n))
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
