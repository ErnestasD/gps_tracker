import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { isPermanent, SmsSendError, type SmsDriver } from '../sms/drivers.js'
import { SMS_QUEUE, type SmsJob } from './smsQueue.js'

/** Charge-guard TTL: bounds the per-delivery claim key well past the max retry window (24 h). */
const CLAIM_TTL_S = 86_400

/**
 * Claim-key lifecycle values. The key is the no-double-charge guard: its VALUE records how far a
 * send got, so a redelivery can decide whether the provider was (possibly) charged.
 * - `attempting` — SET NX right before the provider call; a crash here leaves this value.
 * - `sent`       — the provider accepted the message (written BEFORE the DB row, so a crash after
 *                  the charge still reconciles the row to 'sent' on redelivery).
 * - `ambiguous`  — the provider MAY have been charged but gave no usable confirmation (timeout /
 *                  network drop / 2xx-without-sid). Never auto-resend such a delivery.
 * A provider response that PROVES no charge happened (4xx, or a retryable 429/5xx) DELETES the key
 * instead, so the delivery can be safely retried from scratch.
 */
const CLAIM = { attempting: 'attempting', sent: 'sent', ambiguous: 'ambiguous' } as const

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
/** Reconcile a redelivered (proven-sent) job to 'sent' without touching the provider id. */
async function reconcileSent(pool: Pool, smsDeliveryId: string): Promise<void> {
  await pool.query('UPDATE sms_deliveries SET status = $1 WHERE id = $2', ['sent', smsDeliveryId])
}

/**
 * Send one SMS job. Exported for unit testing without a live queue.
 *
 * No-double-charge (the money invariant): Twilio's create-message is NOT idempotent, so we must never
 * dispatch the same delivery twice. A Redis claim key is SET NX right BEFORE the provider call and its
 * value tracks the send's fate ({@link CLAIM}). The claim is DELETED — allowing a clean retry — ONLY
 * when the provider PROVES no charge occurred: a 4xx (permanent reject) or a retryable 429/5xx (the
 * request reached Twilio and it declined to create the message). Any AMBIGUOUS outcome — a timeout,
 * a network drop, or a 2xx without a message `sid` — MAY have been charged, so the claim is kept
 * ('ambiguous'), the row is marked failed, and we do NOT throw (no BullMQ retry that could re-charge).
 * On redelivery (claim already present) we resend nothing: 'sent' reconciles the row to sent, anything
 * else marks it failed. Trade-off: we prefer a rare under-delivery over ever double-charging.
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
  const claimed = await deps.redis.set(key, CLAIM.attempting, 'EX', CLAIM_TTL_S, 'NX')
  if (claimed === null) {
    // a prior attempt already claimed this delivery — NEVER resend (it may already be charged).
    // Only a proven 'sent' reconciles the row to sent; every other state (attempting = crashed
    // mid-flight, ambiguous = unconfirmed send) marks failed without touching the provider.
    const state = await deps.redis.get(key)
    if (state === CLAIM.sent) await reconcileSent(deps.pool, smsDeliveryId)
    else await markFailed(deps.pool, smsDeliveryId, `not resent (prior attempt: ${state ?? 'expired'})`)
    return
  }

  try {
    const { providerMessageId } = await deps.driver.send(to, body)
    // record the (charged) send in the claim BEFORE the DB write, so a crash here still reconciles
    // the row to 'sent' on redelivery rather than losing the fact of the charge
    await deps.redis.set(key, CLAIM.sent, 'EX', CLAIM_TTL_S)
    await markSent(deps.pool, smsDeliveryId, providerMessageId)
    deps.onSent?.()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'sms send failed'
    // A response-bearing SmsSendError (status >= 400) proves the provider saw the request and did
    // NOT create a message — no charge. 4xx = permanent (stop); 429/5xx = transient (retry). Either
    // way the delivery was never charged, so we release the claim.
    if (err instanceof SmsSendError && err.status >= 400) {
      await deps.redis.del(key)
      await markFailed(deps.pool, smsDeliveryId, message)
      deps.onFailed?.()
      if (!isPermanent(err.status)) throw err // transient → BullMQ retry from a clean claim
      return
    }
    // Otherwise the outcome is AMBIGUOUS (timeout / network drop / 2xx-without-sid): the message may
    // have been sent and charged. Keep the claim so no retry re-charges it, mark the row failed, and
    // do NOT throw — an operator resends via a NEW delivery if the config SMS truly never arrived.
    await deps.redis.set(key, CLAIM.ambiguous, 'EX', CLAIM_TTL_S)
    await markFailed(deps.pool, smsDeliveryId, `ambiguous (not resent): ${message}`)
    deps.onFailed?.()
  }
}

/** BullMQ worker sending queued SMS. concurrency 4 (I/O-bound provider HTTP). Caller closes on drain. */
export function startSmsWorker(deps: SmsWorkerDeps): Worker<SmsJob> {
  return new Worker<SmsJob>(SMS_QUEUE, (job) => runSms(deps, job), { connection: deps.connection, concurrency: 4 })
}
