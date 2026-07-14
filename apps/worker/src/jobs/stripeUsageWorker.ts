import { Worker, type ConnectionOptions } from 'bullmq'

import type { Db } from '@orbetra/db'

import { reportDailyOverage, type StripeUsagePort } from '../billing/usageReporter.js'
import { STRIPE_USAGE_QUEUE } from './stripeUsageQueue.js'

export interface StripeUsageWorkerDeps {
  connection: ConnectionOptions
  db: Db
  stripe: StripeUsagePort
  /** current time (ms) source — injectable for tests; the job bills the PREVIOUS UTC day. */
  now?: () => number
  onReported?: (r: { subscribers: number; reported: number; devicesOver: number }) => void
}

/** UTC day (YYYY-MM-DD) N days before the given ms instant. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Daily job: report YESTERDAY's overage to Stripe. concurrency 1 (one report per tick). Errors throw
 * → BullMQ retries; the meter is additive but a same-day double-report would double-count, so the
 * job is scheduled once/day and reports the settled previous day (idempotency at the schedule level).
 */
export function createStripeUsageWorker(deps: StripeUsageWorkerDeps): Worker {
  const now = deps.now ?? Date.now
  return new Worker(
    STRIPE_USAGE_QUEUE,
    async () => {
      const nowMs = now()
      const day = utcDay(nowMs - 24 * 3_600_000) // yesterday (UTC)
      // stamp the meter event at NOON of the billed day (not report-time): a 00:00-aligned run must not
      // push yesterday's usage into today's billing period at a subscription-renewal boundary.
      const timestampS = Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000)
      const r = await reportDailyOverage({ db: deps.db, stripe: deps.stripe }, day, timestampS)
      deps.onReported?.(r)
    },
    { connection: deps.connection, concurrency: 1 },
  )
}
