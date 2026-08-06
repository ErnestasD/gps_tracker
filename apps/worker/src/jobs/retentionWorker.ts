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
 *  - `events` + `trips` COORDINATES — derived LOCATION data, and the reason this sweep exists at
 *    all. `add_retention_policy('positions', …)` was the only horizon in the codebase, so at month
 *    14 the raw chunks were dropped while `events` kept lat/lon for every geofence crossing and
 *    panic, and `trips` kept exact start/end coordinates with timestamps and driver — a years-old
 *    commute fully reconstructable from tables nothing pruned, after the privacy policy, the Terms
 *    and the DPA had all told the customer that data was deleted. Events are DELETED; trips are
 *    stripped of coordinates but kept, because distance/duration/driver are the basis of historical
 *    reports and of a mileage claim a customer may have to defend years later (founder decision).
 *  - the TOKEN tables — `refresh_tokens` grows by a row per login AND per rotation, forever, on the
 *    path every authenticated request depends on. Only DEAD rows past their own expiry are removed.
 *  - `raw_rejects` — §3.6 sanity failures, now that a drain actually writes them. Without a sweep
 *    the drain would trade a self-trimming 100k Redis stream for a permanently growing Postgres
 *    table of IMEIs and raw AVL bytes, and those bytes embed lat/lon (§3.4) — personal data the
 *    privacy policy and the DPA both promise to delete at 13 months. A diagnostic tail does not
 *    need a year: 90 days is far past the point where anyone is still investigating.
 */
/** The tables the sweep touches, for the per-table `retention_pruned_total` counter. */
export type RetentionTable = 'webhook_deliveries' | 'raw_rejects' | 'billing_events' | 'events' | 'trips_coords' | 'refresh_tokens' | 'password_reset_tokens' | 'affiliate_password_tokens'

/** The platform-wide raw-location horizon, in days. MUST match `add_retention_policy('positions',
 *  drop_after => interval '13 months')` in sql/001_positions.sql and the 13 months the privacy
 *  policy, the Terms and the DPA all state — those are contractual, and this is what makes them
 *  true of derived location data too. */
export const LOCATION_RETENTION_DAYS = 396 // 13 months

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
  /** window for derived LOCATION data — `events` rows and `trips` coordinates (default 396 = 13
   *  months, matching the positions hypertable policy and the published privacy text). */
  locationRetentionDays?: number
  /** window for dead auth tokens (default 30). They are only pruned once ALSO past `expiresAt`. */
  tokenRetentionDays?: number
  onPruned?: (table: RetentionTable, rows: number) => void
  onFailed?: () => void
}

/** Run one sweep. Returns rows deleted. `retentionDays` is clamped to ≥ 1 so a misconfigured
 *  negative/zero value can never prune today's live delivery log (footgun guard). */
export async function runRetentionSweep(
  db: Db,
  retentionDays: number,
  nowMs: number,
  rejectRetentionDays = 90,
  onPruned?: (table: RetentionTable, rows: number) => void,
  billingEventRetentionDays = 90,
  locationRetentionDays = LOCATION_RETENTION_DAYS,
  tokenRetentionDays = 30,
): Promise<number> {
  const days = Number.isFinite(retentionDays) ? Math.max(1, retentionDays) : 30
  const cutoff = new Date(nowMs - days * 24 * 3_600_000)
  const rejectDays = Number.isFinite(rejectRetentionDays) ? Math.max(1, rejectRetentionDays) : 90
  const rejectCutoff = new Date(nowMs - rejectDays * 24 * 3_600_000)
  const billingDays = Number.isFinite(billingEventRetentionDays) ? Math.max(7, billingEventRetentionDays) : 90
  const billingCutoff = new Date(nowMs - billingDays * 24 * 3_600_000)
  // floored at 30 days, not 1: this one DESTROYS customer location history, and a fat-fingered
  // `RETENTION_LOCATION_DAYS=1` would silently erase a fleet's entire event log on the next tick.
  const locationDays = Number.isFinite(locationRetentionDays) ? Math.max(30, locationRetentionDays) : LOCATION_RETENTION_DAYS
  const locationCutoff = new Date(nowMs - locationDays * 24 * 3_600_000)
  const tokenDays = Number.isFinite(tokenRetentionDays) ? Math.max(1, tokenRetentionDays) : 30
  const tokenCutoff = new Date(nowMs - tokenDays * 24 * 3_600_000)
  // allSettled, and each table reports its own count: with Promise.all the first rejection skipped
  // `onPruned` entirely, so rows the OTHER prune had already deleted were never counted — and they
  // are gone, so no later run can count them. The per-table label is also the only evidence that the
  // raw_rejects horizon is real; one summed number cannot show whether that prune ever ran.
  const tasks: [RetentionTable, Promise<number>][] = [
    ['webhook_deliveries', db.webhookDeliveries.pruneOlderThan(cutoff)],
    ['raw_rejects', db.rawRejects.pruneOlderThan(rejectCutoff)],
    // its own window, floored at 7 days — an order of magnitude past Stripe's ~3-day retry horizon,
    // so pruning can never resurrect a redelivery the ledger exists to suppress
    ['billing_events', db.tenants.pruneBillingEvents(billingCutoff)],
    ['events', db.events.pruneOlderThan(locationCutoff)],
    ['trips_coords', db.trips.stripCoordinatesOlderThan(locationCutoff)],
    ['refresh_tokens', db.auth.tokenRetention.pruneRefreshTokens(tokenCutoff)],
    ['password_reset_tokens', db.auth.tokenRetention.pruneResetTokens(tokenCutoff)],
    ['affiliate_password_tokens', db.auth.tokenRetention.pruneAffiliateTokens(tokenCutoff)],
  ]
  // allSettled, and each table reports its own count: with Promise.all the first rejection skipped
  // `onPruned` entirely, so rows the OTHER prunes had already deleted were never counted — and they
  // are gone, so no later run can count them.
  const settled = await Promise.allSettled(tasks.map(([, p]) => p))
  let total = 0
  for (const [i, [table]] of tasks.entries()) {
    const r = settled[i]!
    if (r.status === 'fulfilled') {
      onPruned?.(table, r.value)
      total += r.value
    }
  }
  const failure = settled.find((r) => r.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason))
  return total
}

/** BullMQ worker running the daily retention sweep. Caller must close() on shutdown. */
export function startRetentionWorker(deps: RetentionWorkerDeps): Worker {
  return new Worker(
    RETENTION_QUEUE,
    async () => {
      try {
        await runRetentionSweep(
          deps.db,
          deps.retentionDays,
          Date.now(),
          deps.rejectRetentionDays,
          deps.onPruned,
          deps.billingEventRetentionDays,
          deps.locationRetentionDays,
          deps.tokenRetentionDays,
        )
      } catch (err) {
        deps.onFailed?.()
        throw err // let BullMQ record the failure; the next daily run retries the window
      }
    },
    { connection: deps.connection },
  )
}
