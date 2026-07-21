import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { isPermanent, SmsSendError, type SmsDriver } from '../sms/drivers.js'
import { SMS_QUEUE, type SmsJob } from './smsQueue.js'

/** Charge-guard TTL: bounds the per-delivery claim key well past the max retry window (24 h). */
const CLAIM_TTL_S = 86_400

export interface SmsWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  redis: Redis
  /** env-gated Twilio driver (smsDriverFromEnv). Absent ⇒ SMS not configured: a job marks its
   *  delivery failed ('sms not configured') and returns — NOT a retryable failure. */
  driver?: SmsDriver | undefined
  onSent?: () => void
  onFailed?: () => void
}

function claimKey(smsDeliveryId: string): string {
  return `sms:sent:${smsDeliveryId}`
}

/** Reconcile a delivery row to a terminal status (raw SQL — the worker has no repo layer). */
async function markSent(pool: Pool, smsDeliveryId: string, providerMessageId: string): Promise<void> {
  await pool.query('UPDATE sms_deliveries SET status = $1, "providerMessageId" = $2, "sentAt" = now() WHERE id = $3', ['sent', providerMessageId, smsDeliveryId])
}
async function markFailed(pool: Pool, smsDeliveryId: string, error: string): Promise<void> {
  await pool.query('UPDATE sms_deliveries SET status = $1, error = $2 WHERE id = $3', ['failed', error, smsDeliveryId])
}
/** Reconcile a redelivered (already-claimed) job to 'sent' without touching the provider id. */
async function reconcileSent(pool: Pool, smsDeliveryId: string): Promise<void> {
  await pool.query('UPDATE sms_deliveries SET status = $1 WHERE id = $2', ['sent', smsDeliveryId])
}

/**
 * Send one SMS job. Exported for unit testing without a live queue.
 *
 * Idempotency / no-double-charge: a Redis claim key is SET NX BEFORE the send. If the claim already
 * exists (a redelivery of a job whose prior attempt already sent), we do NOT resend — we reconcile
 * the row to 'sent' and return. A driver that reports a PERMANENT failure (Twilio 4xx) releases the
 * claim, marks the row failed, and returns WITHOUT throwing (no retry). A TRANSIENT failure (429 /
 * 5xx / network) releases the claim, writes a 'failed' breadcrumb, and THROWS so BullMQ retries.
 */
export async function runSms(deps: SmsWorkerDeps, job: Job<SmsJob>): Promise<void> {
  const { smsDeliveryId, to, body } = job.data
  if (deps.driver === undefined) {
    // env-gated off: not a retryable failure — record the config gap and stop
    await markFailed(deps.pool, smsDeliveryId, 'sms not configured')
    deps.onFailed?.()
    return
  }

  const key = claimKey(smsDeliveryId)
  const claimed = await deps.redis.set(key, '1', 'EX', CLAIM_TTL_S, 'NX')
  if (claimed === null) {
    // a prior attempt already claimed (and, per our release discipline, already sent) this delivery
    // — never resend a charged SMS; just reconcile the row and finish
    await reconcileSent(deps.pool, smsDeliveryId)
    return
  }

  try {
    const { providerMessageId } = await deps.driver.send(to, body)
    await markSent(deps.pool, smsDeliveryId, providerMessageId)
    deps.onSent?.()
  } catch (err) {
    const permanent = err instanceof SmsSendError && isPermanent(err.status)
    // release the claim so a transient retry can re-attempt; a permanent failure releases it too so
    // the key never lingers for a delivery that was never actually sent
    await deps.redis.del(key)
    const message = err instanceof Error ? err.message : 'sms send failed'
    await markFailed(deps.pool, smsDeliveryId, message)
    deps.onFailed?.()
    if (!permanent) throw err instanceof Error ? err : new Error('sms send failed') // transient → BullMQ retry
  }
}

/** BullMQ worker sending queued SMS. concurrency 4 (I/O-bound provider HTTP). Caller closes on drain. */
export function startSmsWorker(deps: SmsWorkerDeps): Worker<SmsJob> {
  return new Worker<SmsJob>(SMS_QUEUE, (job) => runSms(deps, job), { connection: deps.connection, concurrency: 4 })
}
