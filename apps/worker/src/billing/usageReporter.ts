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
  /** Report a day's excess-device value to the overage meter for a customer. */
  reportUsage(opts: { customerId: string; value: number; timestampS: number }): Promise<void>
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
    if (k === undefined || k === '' || v === undefined) continue
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) included[k] = Math.floor(n)
  }
  const stripe = new Stripe(secretKey)
  return {
    includedFor: (basePriceId) => included[basePriceId],
    reportUsage: async ({ customerId, value, timestampS }) => {
      await stripe.billing.meterEvents.create({
        event_name: meterEvent,
        payload: { value: String(value), stripe_customer_id: customerId },
        timestamp: timestampS,
      })
    },
  }
}

export interface UsageReporterDeps {
  db: Db
  stripe: StripeUsagePort
}

/**
 * Report overage for a single UTC day (default: yesterday). Returns counts for observability.
 * `dayIso` = the YYYY-MM-DD to bill; `timestampS` = the meter-event timestamp (within the period).
 */
export async function reportDailyOverage(
  deps: UsageReporterDeps,
  dayIso: string,
  timestampS: number,
): Promise<{ subscribers: number; reported: number; devicesOver: number }> {
  const subs = await deps.db.tenants.listActiveSubscribers()
  let reported = 0
  let devicesOver = 0
  for (const s of subs) {
    if (s.subscriptionPriceId === null) continue
    const included = deps.stripe.includedFor(s.subscriptionPriceId)
    if (included === undefined) continue // Direct plan (or unknown price) — no metered overage
    // active devices for the day = the tenant's usage_daily row count for that day (one row/device-day)
    const rows = await deps.db.usage.tenantSummary({ tenantId: s.tenantId }, { from: dayIso, to: dayIso })
    const active = rows[0]?.deviceDays ?? 0
    const over = overageDevices(active, included)
    if (over <= 0) continue
    await deps.stripe.reportUsage({ customerId: s.stripeCustomerId, value: over, timestampS })
    reported++
    devicesOver += over
  }
  return { subscribers: subs.length, reported, devicesOver }
}
