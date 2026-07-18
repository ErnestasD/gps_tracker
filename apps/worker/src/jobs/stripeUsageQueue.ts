import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Daily Stripe overage-usage queue (ADR-024 PR B2). One repeatable job fires every 24 h and reports
 * yesterday's per-tenant device overage to the Stripe meter. Distinct from the E07-4 `usage-sweep`
 * (which POPULATES usage_daily); this one READS it and pushes overage to Stripe. Repeatable jobs
 * dedupe by scheduler key, so a fleet of workers upsert one schedule and one instance runs per tick.
 */
export const STRIPE_USAGE_QUEUE = 'stripe-usage-daily'
export const STRIPE_USAGE_EVERY_MS = 24 * 3_600_000

export function createStripeUsageQueue(connection: ConnectionOptions): Queue {
  return new Queue(STRIPE_USAGE_QUEUE, { connection })
}

/** Upsert the repeatable daily report. jobId keeps the schedule single across restarts/workers. */
export async function scheduleStripeUsage(queue: Queue): Promise<void> {
  await queue.add(
    'report',
    {},
    {
      repeat: { every: STRIPE_USAGE_EVERY_MS },
      jobId: 'stripe-usage-daily',
      removeOnComplete: true,
      removeOnFail: 100,
      // A single Stripe blip must NOT silently skip a day of overage billing: the next tick computes
      // a NEW day, so the failed day would never be re-billed. Retry with backoff — reportUsage
      // passes an idempotency `identifier` (overage:{day}:{customer}) so a re-fire is a Stripe-side
      // no-op within 24 h (safe to retry). Mirrors enqueueNotify/enqueueWebhook (review MED).
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  )
}
