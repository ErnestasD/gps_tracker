import { Worker, type ConnectionOptions } from 'bullmq'

import type { Db } from '@orbetra/db'

import { RETENTION_QUEUE } from './retentionQueue.js'

/**
 * Data-retention sweep. Deletes rows older than their window via the scoped repos' batched,
 * unscoped prunes (packages/db — rule 2). Daily cadence keeps each prune small after the first
 * pass; the batched DELETE bounds lock time even on that first run.
 *
 * Two tables:
 *  - `webhook_deliveries` — a pure operational record (never billing/compliance evidence), so a
 *    rolling window is safe.
 *  - `billing_events` — the applied-Stripe-event ledger that makes webhook redelivery suppression
 *    durable. Stripe retries a failed delivery for ~3 days, so a row past its window can never
 *    dedupe anything; without a sweep it is an append-only table on the billing path. Its window is
 *    floored at 7 days: pruning inside the retry horizon would silently reopen redelivery.
 *  - `raw_rejects` — §3.6 sanity failures, now that a drain actually writes them. Without a sweep
 *    the drain would trade a self-trimming 100k Redis stream for a permanently growing Postgres
 *    table of IMEIs and raw AVL bytes, and those bytes embed lat/lon (§3.4) — personal data the
 *    privacy policy and the DPA both promise to delete at 13 months. A diagnostic tail does not
 *    need a year: 90 days is far past the point where anyone is still investigating.
 */
export interface RetentionWorkerDeps {
  connection: ConnectionOptions
  db: Db
  retentionDays: number
  /** window for `raw_rejects` (default 90). Diagnostics, not evidence — see the note above. */
  rejectRetentionDays?: number
  /** window for `billing_events` (default 90, floor 7). Its OWN knob: it used to ride on the
   *  raw_rejects window, which is documented as a personal-data minimisation dial — shortening that
   *  to 1–2 days for privacy reasons would have pruned applied Stripe events INSIDE the ~3-day retry
   *  horizon and reopened webhook redelivery. Two unrelated concerns must not share a lever. */
  billingEventRetentionDays?: number
  onPruned?: (table: 'webhook_deliveries' | 'raw_rejects' | 'billing_events', rows: number) => void
  onFailed?: () => void
}

/** Run one sweep. Returns rows deleted. `retentionDays` is clamped to ≥ 1 so a misconfigured
 *  negative/zero value can never prune today's live delivery log (footgun guard). */
export async function runRetentionSweep(
  db: Db,
  retentionDays: number,
  nowMs: number,
  rejectRetentionDays = 90,
  onPruned?: (table: 'webhook_deliveries' | 'raw_rejects' | 'billing_events', rows: number) => void,
  billingEventRetentionDays = 90,
): Promise<number> {
  const days = Number.isFinite(retentionDays) ? Math.max(1, retentionDays) : 30
  const cutoff = new Date(nowMs - days * 24 * 3_600_000)
  const rejectDays = Number.isFinite(rejectRetentionDays) ? Math.max(1, rejectRetentionDays) : 90
  const rejectCutoff = new Date(nowMs - rejectDays * 24 * 3_600_000)
  const billingDays = Number.isFinite(billingEventRetentionDays) ? Math.max(7, billingEventRetentionDays) : 90
  const billingCutoff = new Date(nowMs - billingDays * 24 * 3_600_000)
  // allSettled, and each table reports its own count: with Promise.all the first rejection skipped
  // `onPruned` entirely, so rows the OTHER prune had already deleted were never counted — and they
  // are gone, so no later run can count them. The per-table label is also the only evidence that the
  // raw_rejects horizon is real; one summed number cannot show whether that prune ever ran.
  const [deliveries, rejects, billing] = await Promise.allSettled([
    db.webhookDeliveries.pruneOlderThan(cutoff),
    db.rawRejects.pruneOlderThan(rejectCutoff),
    // its own window, floored at 7 days — an order of magnitude past Stripe's ~3-day retry horizon,
    // so pruning can never resurrect a redelivery the ledger exists to suppress
    db.tenants.pruneBillingEvents(billingCutoff),
  ])
  if (deliveries.status === 'fulfilled') onPruned?.('webhook_deliveries', deliveries.value)
  if (rejects.status === 'fulfilled') onPruned?.('raw_rejects', rejects.value)
  if (billing.status === 'fulfilled') onPruned?.('billing_events', billing.value)
  const failure = [deliveries, rejects, billing].find((r) => r.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason))
  return (
    (deliveries.status === 'fulfilled' ? deliveries.value : 0) +
    (rejects.status === 'fulfilled' ? rejects.value : 0) +
    (billing.status === 'fulfilled' ? billing.value : 0)
  )
}

/** BullMQ worker running the daily retention sweep. Caller must close() on shutdown. */
export function startRetentionWorker(deps: RetentionWorkerDeps): Worker {
  return new Worker(
    RETENTION_QUEUE,
    async () => {
      try {
        await runRetentionSweep(deps.db, deps.retentionDays, Date.now(), deps.rejectRetentionDays, deps.onPruned, deps.billingEventRetentionDays)
      } catch (err) {
        deps.onFailed?.()
        throw err // let BullMQ record the failure; the next daily run retries the window
      }
    },
    { connection: deps.connection },
  )
}
