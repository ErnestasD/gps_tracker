import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Stripe overage-usage queue (ADR-024 PR B2). One repeatable job reports a trailing window of
 * per-tenant device overage to the Stripe meter. Distinct from the E07-4
 * `usage-sweep` (which POPULATES usage_daily); this one READS it and pushes overage to Stripe.
 * Repeatable jobs dedupe by scheduler key, so a fleet of workers upsert one schedule and one
 * instance runs per tick.
 */
export const STRIPE_USAGE_QUEUE = 'stripe-usage-daily'
/**
 * 12 h, not 24. The run is idempotent — a second pass over the same window computes a zero delta and
 * submits nothing — so the only effect of the extra tick is that a day which failed every BullMQ
 * attempt is retried while Stripe's 24 h meter-event dedupe window is still open. At exactly 24 h the
 * retry sat ON the boundary, where an identical resubmission is no longer guaranteed to collapse.
 */
export const STRIPE_USAGE_EVERY_MS = 12 * 3_600_000

export function createStripeUsageQueue(connection: ConnectionOptions): Queue {
  return new Queue(STRIPE_USAGE_QUEUE, { connection })
}

/**
 * Upsert the repeatable report. jobId keeps the schedule single across restarts/workers.
 *
 * The stale-schedule sweep is not optional. BullMQ derives a repeatable's key from its options,
 * `every` included, so CHANGING the interval mints a NEW schedule and leaves the old one ticking
 * forever — nothing removes it. After 24 h → 12 h both would fire, and because `getNextMillis` is
 * epoch-aligned every 24 h boundary is also a 12 h one: two runs at the same millisecond, once a
 * day. On more than one worker replica they interleave, both read the same `prev`, compute
 * different `over` values, submit two DIFFERENT identifiers, and Stripe dedupes neither — the
 * customer is billed twice for overlapping usage.
 */
export async function scheduleStripeUsage(queue: Queue): Promise<void> {
  for (const job of await queue.getRepeatableJobs()) {
    // String() on BOTH sides: `getRepeatableJobs` round-trips `every` through Redis and returns a
    // string, but the newer `getJobSchedulers` API returns a number — comparing a number against a
    // string literal would be true every boot and churn the LIVE schedule instead of a stale one.
    if (job.name === 'report' && String(job.every) !== String(STRIPE_USAGE_EVERY_MS)) {
      await queue.removeRepeatableByKey(job.key)
      console.warn('stripe usage: removed a stale repeatable schedule', job.key)
    }
  }
  await queue.add(
    'report',
    {},
    {
      repeat: { every: STRIPE_USAGE_EVERY_MS },
      jobId: 'stripe-usage-daily',
      removeOnComplete: true,
      removeOnFail: 100,
      // A Stripe blip must not skip a day: the trailing window means the next tick re-checks the
      // same days and submits whatever is still owed, and the `identifier`
      // (overage:{day}:{customer}:{prev}-{over}) makes an identical re-fire a Stripe-side no-op
      // within its 24 h dedupe window. Retry with backoff anyway, so the recovery is minutes rather
      // than half a day. Mirrors enqueueNotify/enqueueWebhook (review MED).
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  )
}
