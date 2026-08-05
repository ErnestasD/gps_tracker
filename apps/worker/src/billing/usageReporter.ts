import Stripe from 'stripe'

import type { Db } from '@orbetra/db'

/**
 * Daily overage usage reporter (Stripe, ADR-024 PR B2). For each tenant with an ACTIVE subscription
 * on a TSP plan (one that has an included-device count), report the day's OVERAGE — the devices
 * beyond the plan's included allowance — to the Stripe overage meter. Direct plans (flat, no
 * included count) are skipped. The overage price is per-device-DAY (monthly rate ÷ 30), so reporting
 * one excess-device value per day sums, over the billing period, to device-days of overage — matching
 * the price unit exactly (reporting a per-device-MONTH value daily would over-bill ~30×).
 *
 * Env-gated: no STRIPE_SECRET_KEY ⇒ the port is null and the job is a no-op.
 */

/** The Stripe surface the reporter needs — injectable so tests use a fake (no SDK/network). */
export interface StripeUsagePort {
  /** Included device count for a base plan (TSP), or undefined for a Direct plan (no overage). */
  includedFor(basePriceId: string): number | undefined
  /** Report a day's excess-device value to the overage meter. `identifier` makes the additive meter
   *  idempotent: a re-fire (retry/restart/replay) with the same id is a Stripe-side no-op within 24 h. */
  reportUsage(opts: { customerId: string; value: number; timestampS: number; identifier: string }): Promise<void>
}

/** Overage = devices beyond the plan's included allowance (never negative). */
export function overageDevices(activeDevices: number, included: number): number {
  return Math.max(0, activeDevices - included)
}

/** Build a Stripe-backed port from env, or null when billing is not configured.
 *  STRIPE_INCLUDED = `basePriceId:count,…`; STRIPE_METER_EVENT defaults to `orbetra_device_overage`. */
export function stripeUsagePortFromEnv(env: NodeJS.ProcessEnv = process.env): StripeUsagePort | null {
  const secretKey = env['STRIPE_SECRET_KEY']
  if (!secretKey) return null
  const meterEvent = env['STRIPE_METER_EVENT'] ?? 'orbetra_device_overage'
  const included: Record<string, number> = {}
  for (const pair of (env['STRIPE_INCLUDED'] ?? '').split(',')) {
    const [k, v] = pair.split(':').map((s) => s.trim())
    // v === '' would coerce Number('') → 0 → bill EVERY device as overage; drop it (no included config)
    if (k === undefined || k === '' || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) included[k] = Math.floor(n)
  }
  const stripe = new Stripe(secretKey)
  return {
    includedFor: (basePriceId) => included[basePriceId],
    reportUsage: async ({ customerId, value, timestampS, identifier }) => {
      await stripe.billing.meterEvents.create({
        event_name: meterEvent,
        // identifier dedupes re-fires within Stripe's 24h window → the additive meter never double-bills
        identifier,
        payload: { value: String(value), stripe_customer_id: customerId },
        timestamp: timestampS,
      })
    },
  }
}

export interface UsageReporterDeps {
  db: Db
  stripe: StripeUsagePort
  /** a TSP tenant whose base price is missing from STRIPE_INCLUDED — a config error, not a plan shape */
  onUnmappedPrice?: (info: { tenantId: string; priceId: string; plan: string }) => void
}

export interface OverageRunResult {
  subscribers: number
  /** meter events actually submitted (one per tenant-day whose delta was positive) */
  reported: number
  /** total excess devices submitted across those events */
  devicesOver: number
  /** tenant-days whose value was RE-submitted as a delta because usage landed late (audit #21) */
  backfilled: number
  /** TSP subscribers skipped for want of an STRIPE_INCLUDED entry — should always be 0 (audit #23) */
  unmappedPrices: number
}

/** UTC day (YYYY-MM-DD) `n` days before the given instant. */
export function utcDayBefore(ms: number, n: number): string {
  return new Date(ms - n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * The days a run bills: the `backfillDays` complete UTC days ending with yesterday, oldest first.
 * Oldest first so a partial failure still advances the days most at risk of falling out of the
 * window.
 */
export function billableDays(nowMs: number, backfillDays: number): string[] {
  const days: string[] = []
  for (let n = Math.max(1, backfillDays); n >= 1; n--) days.push(utcDayBefore(nowMs, n))
  return days
}

/** Stripe's meter accepts backdated events, but only within its own window; keep the trailing window
 *  well inside it. 3 = yesterday + the two days before it. */
export const DEFAULT_BACKFILL_DAYS = 3

/** Noon UTC of a billed day, in seconds — inside the day, so a 00:00-aligned run cannot push usage
 *  across a subscription-renewal boundary into the next billing period. */
export function meterTimestampS(dayIso: string): number {
  return Math.floor(Date.parse(`${dayIso}T12:00:00Z`) / 1000)
}

/**
 * Report overage for a trailing window of UTC days, submitting only what Stripe has NOT been told.
 *
 * WHY A WINDOW AND A DELTA (audit MED #21). The previous version reported `now − 24 h` once, kept no
 * record of it, and had no backfill: a run that threw, a worker that was down at 00:05, or a device
 * that flushed its offline buffer at 00:30 for yesterday was money gone for good — `usage_daily` kept
 * the truth and nothing ever carried it to Stripe. Now each run re-walks the last `backfillDays` days,
 * compares the day's true overage against the CUMULATIVE value in `usage_reports`, and submits the
 * difference. The meter is additive, so submitting the delta converges: a day reported at 4 devices
 * that later grows to 6 gets a +2 event, and a day already correct gets nothing.
 *
 * IDEMPOTENCY. The identifier carries the previously-reported value, so a retry of the SAME delta
 * reuses the SAME identifier (Stripe dedupes it) while a genuinely new delta gets a new one. The
 * residual gap: if Stripe accepts and the `usage_reports` write then fails, the next run re-submits
 * the identical identifier — a no-op inside Stripe's 24 h dedupe window, which every schedule of this
 * job falls inside. A day whose overage DROPS (a device removed retroactively) is never negative-
 * adjusted: meter events cannot go down, so the log keeps the high-water mark and the next real
 * increase is measured from it rather than double-billed.
 */
export async function reportDailyOverage(
  deps: UsageReporterDeps,
  days: string[],
  opts: { timestampFor?: (dayIso: string) => number } = {},
): Promise<OverageRunResult> {
  const timestampFor = opts.timestampFor ?? meterTimestampS
  const subs = await deps.db.tenants.listActiveSubscribers()
  const window = days.slice().sort()
  const from = window[0]
  const to = window[window.length - 1]
  const out: OverageRunResult = { subscribers: subs.length, reported: 0, devicesOver: 0, backfilled: 0, unmappedPrices: 0 }
  if (from === undefined || to === undefined) return out
  let failures = 0
  for (const s of subs) {
    // per-tenant isolation: ONE tenant's Stripe/usage error must not abort the loop and leave
    // every remaining tenant unbilled (review MED). Collect failures and rethrow at the end so
    // BullMQ retries — the report log makes the re-run a no-op for tenants already reported.
    try {
      if (s.subscriptionPriceId === null) continue
      const included = deps.stripe.includedFor(s.subscriptionPriceId)
      if (included === undefined) {
        // A DIRECT plan has no included count by design — flat price, no metered overage. A TSP plan
        // without one is a MISCONFIGURATION: STRIPE_INCLUDED is hand-maintained env, so adding a
        // price in Stripe and forgetting the env entry silently billed every device on that plan as
        // included, forever, with no error anywhere (audit MED #23). The job must not throw — that
        // would leave every OTHER tenant unbilled too — so it is counted and alerted on instead.
        if (s.plan.startsWith('tsp_')) {
          out.unmappedPrices++
          deps.onUnmappedPrice?.({ tenantId: s.tenantId, priceId: s.subscriptionPriceId, plan: s.plan })
          console.error('stripe overage: TSP price missing from STRIPE_INCLUDED — overage NOT billed', s.subscriptionPriceId, 'tenant', s.tenantId)
        }
        continue
      }
      // one read per tenant for the whole window: active devices for a day = that day's usage_daily
      // row count (one row per device-day)
      const [usage, already] = await Promise.all([
        deps.db.usage.tenantSummary({ tenantId: s.tenantId }, { from, to }),
        deps.db.usage.reportedOverage(s.tenantId, { from, to }),
      ])
      const byDay = new Map(usage.map((r) => [r.day, r.deviceDays]))
      for (const day of window) {
        const over = overageDevices(byDay.get(day) ?? 0, included)
        const prev = already.get(day) ?? 0
        const delta = over - prev
        if (delta <= 0) continue // nothing new (or a retroactive decrease — see the doc comment)
        await deps.stripe.reportUsage({
          customerId: s.stripeCustomerId,
          value: delta,
          timestampS: timestampFor(day),
          identifier: `overage:${day}:${s.stripeCustomerId}:${prev}`,
        })
        // AFTER Stripe accepts: recording first would mark a failed submission as billed and
        // under-bill silently — the exact failure mode this whole change exists to remove
        await deps.db.usage.recordOverageReport(s.tenantId, day, over)
        out.reported++
        out.devicesOver += delta
        if (prev > 0) out.backfilled++
      }
    } catch (err) {
      failures++
      console.error('stripe overage report failed for tenant', s.tenantId, err instanceof Error ? err.message : String(err))
    }
  }
  if (failures > 0) throw new Error(`stripe overage: ${failures}/${subs.length} tenant(s) failed for ${from}…${to}`)
  return out
}
