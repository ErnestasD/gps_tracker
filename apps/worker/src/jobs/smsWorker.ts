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

/**
 * The `sent` claim carries the provider's message id: `sent:<sid>`. Without it, a redelivery could
 * only reconcile the row's STATUS and the sid — the one identifier that ties our row to a line on
 * the Twilio invoice — was lost for good. Reads tolerate the bare `sent` written by older builds.
 */
const sentClaim = (providerMessageId: string): string => `${CLAIM.sent}:${providerMessageId}`
const parseSent = (raw: string | null): { sent: boolean; providerMessageId: string | null } =>
  raw === CLAIM.sent
    ? { sent: true, providerMessageId: null }
    : raw !== null && raw.startsWith(`${CLAIM.sent}:`)
      ? { sent: true, providerMessageId: raw.slice(CLAIM.sent.length + 1) }
      : { sent: false, providerMessageId: null }

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
/** Never clobbers a row already proven `sent` — a delivered, charged message must not be
 *  re-labelled failed by a later attempt that only knows the claim was missing. */
async function markFailed(pool: Pool, smsDeliveryId: string, error: string): Promise<void> {
  await pool.query(`UPDATE sms_deliveries SET status = $1, error = $2 WHERE id = $3 AND status <> 'sent'`, ['failed', error, smsDeliveryId])
}

/** The DURABLE half of the charge guard: the delivery row itself. Consulted when the Redis claim is
 *  missing or unhelpful, so a Redis flush / failover cannot license a second charged send. */
async function alreadySent(pool: Pool, smsDeliveryId: string): Promise<boolean> {
  const r = await pool.query<{ status: string; providerMessageId: string | null }>(
    'SELECT status, "providerMessageId" FROM sms_deliveries WHERE id = $1',
    [smsDeliveryId],
  )
  const row = r.rows[0]
  return row !== undefined && (row.status === 'sent' || row.providerMessageId !== null)
}
/**
 * Reconcile a redelivered (proven-sent) job to 'sent'. Restores the provider id when the claim
 * carries one — COALESCE so a claim written by an older build (bare `sent`, no sid) still reconciles
 * the status without clearing a sid the first attempt may have managed to write.
 */
async function reconcileSent(pool: Pool, smsDeliveryId: string, providerMessageId: string | null): Promise<void> {
  await pool.query(
    'UPDATE sms_deliveries SET status = $1, "providerMessageId" = COALESCE($2, "providerMessageId"), "sentAt" = COALESCE("sentAt", now()), error = NULL WHERE id = $3',
    ['sent', providerMessageId, smsDeliveryId],
  )
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
  // The claim alone is not a sufficient guard for a RETRY: the DB write below now throws (so that a
  // transient failure is retried rather than recorded as a lie), and the very events that break that
  // write — a failover, a restart — can also lose the Redis key. A fresh `SET NX` would then succeed
  // and the message would be sent and CHARGED a second time. The durable row is the backstop.
  if (claimed !== null) {
    let proven: boolean
    try {
      proven = await alreadySent(deps.pool, smsDeliveryId)
    } catch (err) {
      // The backstop itself failed. RELEASE the claim before rethrowing: leaving it at `attempting`
      // means the BullMQ retry takes the redelivery branch and records `not resent` — a message that
      // was never handed to the provider, and now never will be. A pg blip must not consume a send.
      await deps.redis.del(key).catch(() => undefined)
      throw err
    }
    if (proven) {
      await deps.redis.del(key).catch(() => undefined) // do not leave a bogus 'attempting' behind
      return
    }
  }
  if (claimed === null) {
    // a prior attempt already claimed this delivery — NEVER resend (it may already be charged).
    // Only a proven 'sent' reconciles the row to sent; every other state (attempting = crashed
    // mid-flight, ambiguous = unconfirmed send) marks failed without touching the provider.
    const state = await deps.redis.get(key)
    const prior = parseSent(state)
    if (prior.sent) await reconcileSent(deps.pool, smsDeliveryId, prior.providerMessageId)
    else if (await alreadySent(deps.pool, smsDeliveryId)) await reconcileSent(deps.pool, smsDeliveryId, null)
    else await markFailed(deps.pool, smsDeliveryId, `not resent (prior attempt: ${state ?? 'expired'})`)
    return
  }

  let providerMessageId: string
  try {
    ;({ providerMessageId } = await deps.driver.send(to, body))
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
    return
  }

  // ── from here the provider ACCEPTED the message and we are charged ────────────────────────────
  // The DB write is OUTSIDE the send's try on purpose (audit MED). It used to sit inside it, so an
  // ordinary pg error — a container restart, a failover, a killed backend, a statement timeout —
  // fell through to the ambiguous branch and did two wrong things at once: it OVERWROTE the `sent`
  // claim (the only durable proof of the charge) with `ambiguous`, and it marked a delivered message
  // `failed` while discarding the provider id. The design's own recovery seam then became
  // unreachable, and its documented remedy — "an operator resends via a new delivery" — was exactly
  // the wrong action: the message was definitely delivered and definitely charged. A hard crash
  // preserved the evidence; a thrown error erased it.
  //
  // Now the claim records the sid, and a DB failure THROWS: BullMQ retries, the redelivery path sees
  // `sent:<sid>` and reconciles the row without touching the provider.
  // The claim write is best-effort and must NOT skip the row write: if it threw, the claim stayed
  // `attempting`, the retry took the redelivery branch, and a delivered message was recorded failed
  // with its sid discarded — the same defect this block describes, moved one line earlier.
  await deps.redis.set(key, sentClaim(providerMessageId), 'EX', CLAIM_TTL_S).catch((e: unknown) => {
    console.error('sms claim write failed (the row write below is the durable record)', e)
  })
  await markSent(deps.pool, smsDeliveryId, providerMessageId)
  deps.onSent?.()
}

/** BullMQ worker sending queued SMS. concurrency 4 (I/O-bound provider HTTP). Caller closes on drain. */
export function startSmsWorker(deps: SmsWorkerDeps): Worker<SmsJob> {
  return new Worker<SmsJob>(SMS_QUEUE, (job) => runSms(deps, job), { connection: deps.connection, concurrency: 4 })
}
