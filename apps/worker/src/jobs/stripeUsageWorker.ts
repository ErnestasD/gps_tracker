import { Worker, type ConnectionOptions } from 'bullmq'

import type { Db } from '@orbetra/db'

import { DEFAULT_BACKFILL_DAYS, billableDays, reportDailyOverage, type OverageRunResult, type StripeUsagePort } from '../billing/usageReporter.js'
import { STRIPE_USAGE_QUEUE } from './stripeUsageQueue.js'

export interface StripeUsageWorkerDeps {
  connection: ConnectionOptions
  db: Db
  stripe: StripeUsagePort
  /** current time (ms) source — injectable for tests; the job bills COMPLETE UTC days only. */
  now?: () => number
  /** how many trailing days each run re-checks (env `STRIPE_BACKFILL_DAYS`, default 3). */
  backfillDays?: number
  onReported?: (r: OverageRunResult) => void
  /** the run THREW — a stalled overage reporter is silent UNDER-BILLING, so it must be visible */
  onFailed?: () => void
  /** a TSP price with no STRIPE_INCLUDED entry — config error, zero overage billed for that plan */
  onUnmappedPrice?: (info: { tenantId: string; priceId: string; plan: string }) => void
}

/**
 * Daily job: report the trailing window's overage to Stripe. concurrency 1 (one run per tick).
 *
 * The window (not just yesterday) is the fix for audit #21: usage for a day keeps arriving after that
 * day ends — a device that was out of coverage flushes its buffer, the ordered pipeline is catching
 * up, or this very job was down — and the old single-shot "bill yesterday, keep no record" had
 * exactly one chance to see it. Re-walking the last few days and submitting the DELTA against
 * `usage_reports` makes a missed or premature run self-correcting instead of permanently lost revenue.
 *
 * Errors still throw → BullMQ retries; the report log makes the retry a no-op for whatever already
 * landed, so a retry cannot double-bill.
 */
export function createStripeUsageWorker(deps: StripeUsageWorkerDeps): Worker {
  const now = deps.now ?? Date.now
  const backfillDays = deps.backfillDays ?? DEFAULT_BACKFILL_DAYS
  return new Worker(
    STRIPE_USAGE_QUEUE,
    async () => {
      const days = billableDays(now(), backfillDays)
      try {
        const r = await reportDailyOverage({ db: deps.db, stripe: deps.stripe, ...(deps.onUnmappedPrice ? { onUnmappedPrice: deps.onUnmappedPrice } : {}) }, days)
        deps.onReported?.(r)
      } catch (err) {
        // a stalled metering pipeline is silent UNDER-BILLING: usage_daily keeps the truth but
        // nothing reaches Stripe. The window recovers a few missed runs on its own; one that stays
        // broken longer than the window is money lost, so it must still page.
        deps.onFailed?.()
        throw err
      }
    },
    { connection: deps.connection, concurrency: 1 },
  )
}

/** `STRIPE_BACKFILL_DAYS`, clamped to 1…14 — a longer window would start submitting meter events
 *  Stripe rejects as too old, and a shorter one is the single-shot behaviour this replaced. */
export function backfillDaysFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env['STRIPE_BACKFILL_DAYS'])
  if (!Number.isFinite(n)) return DEFAULT_BACKFILL_DAYS
  return Math.min(14, Math.max(1, Math.floor(n)))
}
