import { z } from 'zod'

/**
 * Tenant plans (founder decision 2026-07-20) — the tenant-level entitlement axis
 * that sits ORTHOGONAL to RBAC roles (roles.ts). Two tracks:
 *   - `direct_N`  — Track A self-service small fleets: single account, NO white-label,
 *                   NO sub-accounts/API/webhooks; capped at N devices.
 *   - `tsp_*`     — Track B white-label/reseller: white-label + custom domains + sub-accounts
 *                   + REST API + webhooks + priority support; no device cap. Scale/Enterprise
 *                   additionally unlock SSO, data residency and the 99.9% SLA.
 *
 * MUST mirror the Prisma `TenantPlan` enum (packages/db/prisma/schema.prisma) —
 * asserted by packages/shared/__tests__/plans.spec.ts, the same pattern as roles.spec.ts.
 */
export const TENANT_PLANS = [
  'direct_5',
  'direct_10',
  'direct_25',
  'direct_50',
  'direct_100',
  'tsp_start',
  'tsp_grow',
  'tsp_scale',
  'tsp_enterprise',
] as const

export type TenantPlan = (typeof TENANT_PLANS)[number]

export const tenantPlanSchema = z.enum(TENANT_PLANS)

/**
 * Derived, typed entitlement matrix — the SINGLE SOURCE consumed by api (403 gating)
 * and web (nav/route hiding). Booleans are hard feature gates; `deviceLimit` is the
 * Direct device cap (null = uncapped, all TSP plans).
 */
export const entitlementsSchema = z.strictObject({
  whiteLabel: z.boolean(),
  customDomains: z.boolean(),
  subAccounts: z.boolean(),
  apiAccess: z.boolean(),
  webhooks: z.boolean(),
  prioritySupport: z.boolean(),
  /** SMS gateway: send Teltonika config SMS to a device's SIM (SMS gateway feature). TSP-only. */
  smsGateway: z.boolean(),
  // NOTE: `sso` and `dataResidency` were here and granted on Scale/Enterprise, but NOTHING in the
  // codebase read them — there is no SSO code path and no residency routing. An entitlement that
  // grants nothing is a promise the product cannot keep, and a sales conversation reading this
  // matrix would have promised both. Removed 2026-08-04 (founder decision, audit finding).
  // Re-add together with the implementation, not before it.
  sla999: z.boolean(),
  /** max non-retired devices; null = uncapped (all TSP plans). */
  deviceLimit: z.number().int().nonnegative().nullable(), // 0 = fail-closed cap; null = uncapped (TSP)
})
export type Entitlements = z.infer<typeof entitlementsSchema>

/** The boolean feature gates only (everything except the numeric deviceLimit). */
export type EntitlementKey = keyof Omit<Entitlements, 'deviceLimit'>

/**
 * Stripe subscription statuses that FORFEIT paid entitlements. A subscription that lapsed
 * (canceled / final-retry unpaid / never-completed / paused) drops the tenant to the zero floor —
 * regardless of what tier the `plan` column still records (the webhook re-asserts the price-derived
 * tier even on `subscription.deleted`). `past_due` is deliberately NOT here: it is Stripe's dunning
 * grace window, so a temporary card failure keeps access while retries run. `null` (admin-granted,
 * never subscribed — e.g. seeded/onboarded tenants) also keeps its plan.
 */
export const LAPSED_SUBSCRIPTION_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired', 'paused'])

/**
 * Is this tenant receiving PAID service right now — and therefore billable for overage?
 *
 * "Entitled" and "metered" MUST be the same set, derived from one predicate. They used to be two
 * independent lists: entitlements deliberately excluded `past_due` from the lapsed set (dunning
 * grace) while the usage reporter only selected `('active','trialing')`, so for the whole dunning
 * window a tenant kept white-label, sub-accounts, API, webhooks, SMS and an uncapped device count
 * while not a single device-day was billed. `usage_daily` still recorded the truth, but the reporter
 * only ever submits `now − 24 h` and never backfills, so those days were lost permanently even after
 * the card was fixed — roughly €283 per incident at TSP Grow scale. Audit high.
 */
export function isBillableSubscription(subscriptionStatus: string | null): boolean {
  if (subscriptionStatus === null) return false // admin-granted / never subscribed — nothing to meter
  return !LAPSED_SUBSCRIPTION_STATUSES.has(subscriptionStatus)
}

/** The zero-entitlement floor: a lapsed subscription grants no paid feature and a 0 device cap. */
export const FLOOR_ENTITLEMENTS: Entitlements = {
  whiteLabel: false,
  customDomains: false,
  subAccounts: false,
  apiAccess: false,
  webhooks: false,
  prioritySupport: false,
  smsGateway: false,
  sla999: false,
  deviceLimit: 0,
}

/**
 * The entitlements a tenant ACTUALLY gets, gated on its live Stripe subscription status. A lapsed
 * subscription forfeits every paid feature (this is what stops a non-paying tenant keeping billable
 * features like `smsGateway`, or an uncapped device count). Everything else — active / trialing /
 * `past_due` (grace) / `null` (never subscribed / admin-granted) — keeps the plan's full matrix.
 */
export function effectiveEntitlements(plan: TenantPlan, subscriptionStatus: string | null): Entitlements {
  return subscriptionStatus !== null && LAPSED_SUBSCRIPTION_STATUSES.has(subscriptionStatus) ? FLOOR_ENTITLEMENTS : planEntitlements(plan)
}

/**
 * The SINGLE source of entitlement truth including the F2 self-serve TRIAL window.
 *
 * A tenant on `trialing` past its `currentPeriodEnd` floors immediately (no sweep — expiry is
 * enforced at read time). This MUST only ever apply to a LOCAL trial: one we mint at self-serve
 * signup, which has NO Stripe subscription behind it. A Stripe-side trial (a price with
 * trial_period_days) also reports `trialing` with `currentPeriodEnd` = the trial end, and between
 * that instant and the `customer.subscription.updated` webhook a PAYING customer would otherwise be
 * floored to zero — losing white-label, API, webhooks and their whole device cap, permanently if
 * that webhook were lost (review HIGH). `stripeSubscriptionId` is the discriminator: local trials
 * have none. Callers that cannot supply it must pass `undefined`, which is treated as "not a local
 * trial" (fail-safe: never floor what we can't prove is local).
 *
 * Used by BOTH the authoritative server gate (db.tenants.getEntitlements) and the session hint the
 * web nav reads, so the UI can never show a feature the server would 403 — pass the same clock.
 */
export function effectiveEntitlementsAt(
  plan: TenantPlan,
  subscriptionStatus: string | null,
  currentPeriodEnd: Date | null,
  stripeSubscriptionId: string | null | undefined,
  now: Date = new Date(),
): Entitlements {
  // `undefined` (caller couldn't supply it) is deliberately NOT treated as a local trial — see header.
  const isLocalTrial = subscriptionStatus === 'trialing' && stripeSubscriptionId === null
  if (isLocalTrial && currentPeriodEnd !== null && currentPeriodEnd < now) return FLOOR_ENTITLEMENTS
  return effectiveEntitlements(plan, subscriptionStatus)
}

/** Per-Direct-plan device cap; the plan suffix IS the cap. */
const DIRECT_DEVICE_LIMIT: Record<string, number> = {
  direct_5: 5,
  direct_10: 10,
  direct_25: 25,
  direct_50: 50,
  direct_100: 100,
}

/**
 * List monthly price in EUR per plan (PRICING_STRATEGY.md §2 Track A, §3 Track B).
 *
 * Here so the platform console can state recurring revenue without calling Stripe on every page
 * load. It is a LIST price, not an invoice: a tenant on an annual term, a negotiated discount or a
 * coupon pays something else, and only Stripe knows what. Treat the derived figure as "what this
 * book of business is worth at list", which is the number a founder actually steers on.
 *
 * `tsp_enterprise` is deliberately null — it is quoted per deal (§3, "contact"), so inventing a
 * figure for it would silently understate or overstate every total it appears in. The console
 * counts those tenants separately rather than pricing them.
 */
export const PLAN_MONTHLY_EUR: Record<TenantPlan, number | null> = {
  direct_5: 9,
  direct_10: 15,
  direct_25: 35,
  direct_50: 65,
  direct_100: 119,
  tsp_start: 149,
  tsp_grow: 399,
  tsp_scale: 899,
  tsp_enterprise: null, // quoted per deal
}

/**
 * Included-device allowances per TSP plan — PRODUCT truth (PRICING_STRATEGY.md §3, revised
 * 2026-09-02: 300 / 1,000 / 3,500). The BILLING truth lives worker-side in STRIPE_INCLUDED
 * (price id → count); if pricing changes, both move in the same commit — the runbook says so.
 * null = quoted per deal (enterprise). Used by the reseller dashboard's allowance meter.
 */
export const TSP_INCLUDED_DEVICES: Record<TenantPlan, number | null> = {
  direct_5: 5,
  direct_10: 10,
  direct_25: 25,
  direct_50: 50,
  direct_100: 100,
  tsp_start: 300,
  tsp_grow: 1_000,
  tsp_scale: 3_500,
  tsp_enterprise: null,
}

/** True for the self-service Track A plans (`direct_*`), false for every `tsp_*` plan. */
export function isDirectPlan(p: TenantPlan): boolean {
  return p.startsWith('direct_')
}

/**
 * The full entitlement matrix for a plan (founder-locked 2026-07-20):
 *   - whiteLabel/customDomains/subAccounts/apiAccess/webhooks/prioritySupport → true for ALL tsp_*, false for all direct_*.
 *   - sla999 → true ONLY for tsp_scale + tsp_enterprise (a support commitment, not a code path).
 *   - deviceLimit → 5/10/25/50/100 for direct_N, null (uncapped) for all tsp_*.
 *   - smsGateway → EVERY plan (founder decision 2026-08-18, was tsp-only).
 *
 * The smsGateway change is a product decision, not a cleanup: pointing a tracker at the server is
 * the first minute a customer ever spends with this product, and making them hand-type
 * `setparam 2004:…` into an SMS is where they are lost. Two messages over a device's lifetime is a
 * few cents of Twilio, and `sms_deliveries` already carries an at-most-once charge guard. It stays
 * an explicit line rather than being folded into some "basic features" default so that reversing it
 * is one edit and one decision.
 */
export function planEntitlements(plan: TenantPlan): Entitlements {
  const tsp = !isDirectPlan(plan)
  const scalePlus = plan === 'tsp_scale' || plan === 'tsp_enterprise'
  return {
    whiteLabel: tsp,
    customDomains: tsp,
    subAccounts: tsp,
    apiAccess: tsp,
    webhooks: tsp,
    prioritySupport: tsp,
    smsGateway: true, // every plan — see the docblock; deliberately NOT `tsp`
    sla999: scalePlus,
    // FAIL-CLOSED on the cap: an unmapped direct_* plan (e.g. a future enum value added without a
    // DIRECT_DEVICE_LIMIT entry) caps at 0 rather than silently uncapping (review LOW). tsp_* = null (uncapped).
    deviceLimit: tsp ? null : (DIRECT_DEVICE_LIMIT[plan] ?? 0),
  }
}
