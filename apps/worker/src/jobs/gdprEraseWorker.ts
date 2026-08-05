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
 * Covers: positions, trips, events, commands, sms_deliveries, raw_rejects (by IMEI), the device
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
 * id it resolved; the IMEI clause is kept, narrowed to rows written before that column existed, so
 * a subject's older data is still erased. Those age out with the 90-day retention sweep.
 */
async function eraseRawRejects(pool: Pool, data: EraseJobData): Promise<void> {
  await pool.query(`DELETE FROM raw_rejects WHERE "deviceId" = $1`, [data.deviceId])
  if (data.imei !== undefined) {
    await pool.query(`DELETE FROM raw_rejects WHERE "deviceId" IS NULL AND imei = $1`, [data.imei])
  }
}

/** Run one erase. Idempotent: every step deletes only what still exists. */
export async function runErase(pool: Pool, redis: Redis, data: EraseJobData): Promise<{ deviceId: string; positions: number }> {
  const idNum = BigInt(data.deviceId)
  // tenant re-check straight from the DB row — the job payload is not trusted as scope proof
  const dev = await pool.query<{ tenantId: string; retiredAt: Date | null; imei: string }>(
    `SELECT "tenantId", "retiredAt", imei FROM devices WHERE id = $1`,
    [data.deviceId],
  )
  if (dev.rowCount === 0) {
    // Device row already gone (retried job past its final step) — finish the cleanup that does NOT
    // depend on it. `raw_rejects` is keyed by IMEI and the drain runs on a 60 s tick, so entries
    // still in the `rejects` stream at erase time land in the table AFTER the row was deleted;
    // without this pass nothing would ever remove them, and their raw AVL bytes embed lat/lon
    // (§3.4) — the exact coordinates the request is about.
    await eraseRawRejects(pool, data)
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
  // raw_rejects keys on IMEI, not deviceId — those rows failed §3.6 before any device was resolved,
  // and their raw AVL bytes embed lat/lon (§3.4). Deleted AFTER the final sweep, for the same
  // resurrection reason positions are: the drain writes on a 60 s tick, so a stream entry can land
  // in the table while this job runs. The drain also drops entries whose IMEI is no longer a
  // registered device, which closes the window for anything arriving later still.
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
