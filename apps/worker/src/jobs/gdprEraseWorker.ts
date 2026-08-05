import { unlink } from 'node:fs/promises'
import { Worker, type ConnectionOptions } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { erasePositions } from '@orbetra/db'

import { GDPR_ERASE_QUEUE, type EraseJobData } from './gdprQueue.js'
import { captureDeviceUsage } from './usageWorker.js'

/**
 * GDPR device-erase cascade (E08-4). The api only enqueues for a RETIRED device it has
 * scope-gated (retire already tore down the ingest registry, so no new data flows while we
 * delete). Order: bulk data first, device row LAST — a crash mid-way leaves the device row
 * as the "erase still owed" marker and the retried job (idempotent) finishes the rest.
 *
 * DELIBERATELY KEPT (documented in the plan): usage_daily (billing, legitimate interest;
 * plain deviceId, no FK) and audit_log (append-only evidence trail; redaction is V2).
 * Also EXPIRES the account's already-produced export files — a standing NDJSON dump contains the
 * device, so leaving one erases the database and not the data.
 * Covers: positions, trips, events, commands, sms_deliveries, raw_rejects (by deviceId), the device
 * row itself and the device's Redis state. A table added after this job ships must be added HERE —
 * two already were not (sms_deliveries, raw_rejects), and nothing failed to say so.
 */
export interface GdprEraseDeps {
  connection: ConnectionOptions
  pool: Pool
  redis: Redis
  onErased?: (r: { deviceId: string; positions: number }) => void
  onFailed?: () => void
}

/** Redis leftovers for one device — live state + command transport + rule/geofence state. */
async function clearRedisState(redis: Redis, deviceId: string): Promise<void> {
  await redis.del(
    `device:${deviceId}:last`,
    `cmd:pending:${deviceId}`,
    `cmd:inflight:${deviceId}`,
    `cmd:resp:${deviceId}`,
    `rule:iostate:${deviceId}`,
    `rule:offline:${deviceId}`,
    `geofence:state:${deviceId}`,
  )
  await redis.srem('cmd:active', deviceId)
  // per-(rule,device) cooldown keys are TTL-bound (≤24 h) — left to expire
  await redis.hdel('device:tenant', deviceId)
  await redis.hdel('device:account', deviceId)
  await redis.hdel('device:config', deviceId)
}

/**
 * Delete this device's sanity-rejected records.
 *
 * By deviceId, NOT by IMEI. `raw_rejects` predates device resolution, so it was keyed on IMEI — and
 * an IMEI is unique among ACTIVE devices only, so after a device is retired and its IMEI
 * re-registered, an IMEI delete reaches rows that belong to a different device. The drain stamps the
 * id it resolved.
 *
 * The IMEI clause is kept for rows written before that column existed, and is BEST-EFFORT rather
 * than a guarantee: once this device's row is deleted the IMEI is claimable again, so a legacy
 * orphan this erase missed could later be removed by the next holder's erase instead. It
 * over-deletes 90-day diagnostics that were already orphaned — the safe direction — and the whole
 * class ages out with the retention sweep.
 */
async function eraseRawRejects(pool: Pool, data: EraseJobData): Promise<void> {
  await pool.query(`DELETE FROM raw_rejects WHERE "deviceId" = $1`, [data.deviceId])
  if (data.imei !== undefined) {
    await pool.query(`DELETE FROM raw_rejects WHERE "deviceId" IS NULL AND imei = $1`, [data.imei])
  }
}

/**
 * Expire the account's produced exports.
 *
 * An export is a point-in-time NDJSON dump on the shared volume, downloadable for its full 7-day
 * life by anyone with the link — and it CONTAINS the device being erased, so leaving one standing
 * erases the database and not the data. The file is unlinked and the row marked, exactly as the
 * hourly sweep does; the requester produces a fresh export that no longer holds the device.
 *
 * Runs BEFORE the devices row is deleted, because that row is this job's completion marker: the
 * header's contract is "device row LAST, so a crash leaves it as 'erase still owed' and the retried
 * job finishes the rest". Placed after it, a SIGKILL mid-unlink meant the retry found no device
 * row, returned early, and BullMQ marked the erase complete with the dump still downloadable.
 *
 * `pending` as well as `done`: a large account's export pages every device and can be minutes in
 * flight, so one enqueued just before the erase would otherwise complete afterwards carrying the
 * data. The export worker's own finalise is scoped to `status = 'pending'` so it cannot resurrect a
 * row this expired.
 */
async function expireAccountExports(pool: Pool, accountId: string): Promise<void> {
  const stale = await pool.query<{ id: string; path: string | null }>(
    `SELECT id, path FROM export_jobs WHERE "accountId" = $1 AND status IN ('done','pending')`,
    [accountId],
  )
  for (const row of stale.rows) {
    if (row.path !== null) await unlink(row.path).catch(() => undefined)
    await pool.query(`UPDATE export_jobs SET status = 'expired', path = NULL WHERE id = $1 AND status IN ('done','pending')`, [row.id])
  }
}

/** Run one erase. Idempotent: every step deletes only what still exists. */
export async function runErase(pool: Pool, redis: Redis, data: EraseJobData): Promise<{ deviceId: string; positions: number }> {
  const idNum = BigInt(data.deviceId)
  // tenant re-check straight from the DB row — the job payload is not trusted as scope proof
  const dev = await pool.query<{ tenantId: string; accountId: string; retiredAt: Date | null; imei: string }>(
    `SELECT "tenantId", "accountId", "retiredAt", imei FROM devices WHERE id = $1`,
    [data.deviceId],
  )
  if (dev.rowCount === 0) {
    // Device row already gone (retried job past its final step) — finish the cleanup that does NOT
    // depend on it. The drain runs on a 60 s tick, so entries still in the `rejects` stream at erase
    // time land in the table AFTER the row was deleted;
    // without this pass nothing would ever remove them, and their raw AVL bytes embed lat/lon
    // (§3.4) — the exact coordinates the request is about.
    await eraseRawRejects(pool, data)
    if (data.accountId !== undefined) await expireAccountExports(pool, data.accountId)
    await clearRedisState(redis, data.deviceId)
    return { deviceId: data.deviceId, positions: 0 }
  }
  if (dev.rows[0]!.tenantId !== data.tenantId) throw new Error('erase job tenant mismatch') // never delete across tenants
  if (dev.rows[0]!.retiredAt === null) throw new Error('erase requires a retired device')

  // bill any un-swept days BEFORE the positions vanish (audit P4): the hourly sweep reads positions,
  // so erasing between sweeps would drop days used since the last one. usage_daily is kept past erase
  // (billing record), so this is the last chance to attribute them. Runs while the devices row exists.
  await captureDeviceUsage(pool, idNum, Date.now())

  const positions = await erasePositions(pool, idNum)
  await pool.query(`DELETE FROM trips WHERE "deviceId" = $1`, [data.deviceId])
  await pool.query(`DELETE FROM events WHERE "deviceId" = $1`, [data.deviceId])
  await pool.query(`DELETE FROM commands WHERE "deviceId" = $1`, [data.deviceId])
  // sms_deliveries postdates this job and was never folded in (audit MED): every row holds a phone
  // number and the message body, so an erase that leaves them behind leaves the most directly
  // identifying data of all — the subject's own number.
  await pool.query(`DELETE FROM sms_deliveries WHERE "deviceId" = $1`, [data.deviceId])
  await expireAccountExports(pool, dev.rows[0]!.accountId)
  await clearRedisState(redis, data.deviceId)
  await pool.query(`DELETE FROM devices WHERE id = $1`, [data.deviceId]) // LAST — see header
  // FINAL sweep (review HIGH-1): a session that outlived retire or stream backlog may have
  // inserted rows while the windows above ran; device ids are never reused (autoincrement),
  // so one more pass after the row delete closes the resurrection window for good.
  const late = await erasePositions(pool, idNum)
  if (late > 0) {
    await pool.query(`DELETE FROM trips WHERE "deviceId" = $1`, [data.deviceId])
    await pool.query(`DELETE FROM events WHERE "deviceId" = $1`, [data.deviceId])
  }
  // raw_rejects: records that failed §3.6, whose raw AVL bytes embed lat/lon (§3.4). Deleted AFTER
  // the final sweep, for the same resurrection reason positions are — the drain writes on a 60 s
  // tick, so a stream entry can land in the table while this job runs. The drain also drops entries
  // whose device row is ABSENT, which closes the window for anything arriving later still.
  await eraseRawRejects(pool, { ...data, imei: data.imei ?? dev.rows[0]!.imei })

  return { deviceId: data.deviceId, positions: positions + late }
}

export function startGdprEraseWorker(deps: GdprEraseDeps): Worker<EraseJobData> {
  return new Worker<EraseJobData>(
    GDPR_ERASE_QUEUE,
    async (job) => {
      try {
        const r = await runErase(deps.pool, deps.redis, job.data)
        deps.onErased?.(r)
      } catch (err) {
        deps.onFailed?.()
        throw err // BullMQ retries (bounded)
      }
    },
    { connection: deps.connection, concurrency: 1 },
  )
}
