import type { Hono } from 'hono'
import type { Redis } from 'ioredis'

import type { Db, PaidInvoice, SubscriptionUpdate } from '@orbetra/db'
import type { TenantDeviceRow } from '@orbetra/registry'
import { isDirectPlan } from '@orbetra/shared'
import type { BillingDetailsView, BillingPlanView, BillingView, PlanChangePreviewView, Role } from '@orbetra/shared'

import type { StripeGateway } from '../billing/stripe.js'
import { problem, type AuthContext, type AuthEnv } from '../auth/middleware.js'

/**
 * Billing API (Stripe, ADR-024). Tenant-self routes — tenant is taken from the JWT, NEVER a param
 * — so these are manifest-exempt with a dedicated isolation test. Billing data + actions are
 * admin-only (matches `usage`). When the Stripe gateway is absent (no server keys) every route
 * degrades to a clear signal: GET reports `configured:false`, mutations 503. Subscription STATE is
 * written ONLY by the signature-verified webhook — the browser is never trusted to report payment.
 */
const TENANT_ADMINS: Role[] = ['platform_admin', 'tsp_admin']
/**
 * Billing is TENANT-WIDE state, so the admin role is not enough — the admin must also be tenant-wide.
 *
 * `POST /v1/users` accepts `{role:'tsp_admin', accountId:<uuid>}` and `canGrantRole('tsp_admin',
 * 'tsp_admin')` is true, so an admin PINNED to one account is a principal the API creates on
 * request. Every repo honours that pin through `scopedWhere`; `tenants.getBilling` does not, because
 * a subscription belongs to the tenant and has no accountId to be scoped by. Gating on role alone
 * therefore handed one end-customer's admin a Stripe Customer Portal session for the RESELLER —
 * their invoices, their payment method, and the cancel button — plus the ability to start a new
 * subscription on the reseller's customer. `crud.ts` already applies this same test (`tenantWide`)
 * to `/v1/usage` and `/v1/audit`; billing was the third surface of the same shape and was missed.
 */
const isTenantWideAdmin = (auth: AuthContext): boolean => TENANT_ADMINS.includes(auth.role) && auth.accountId === undefined

export interface BillingDeps {
  db: Db
  stripe?: StripeGateway | undefined
  /** absolute base for Checkout success/cancel + portal return; falls back to the request Origin */
  appBaseUrl?: string | undefined
  /** used for a short-lived per-tenant checkout lock (audit LOW TOCTOU mitigation); optional. */
  redis?: Redis | undefined
  /** public site origin — the partner portal link in the "you earned X" notice. Absent ⇒ no notice. */
  siteUrl?: string | undefined
  /** the "you earned X" notice could not be queued. The commission is already recorded and nothing
   *  retries the mail, so without this a systematically dropped notice is invisible. */
  onPartnerMailFailed?: () => void | undefined
  /** the partner-notification queue. Absent ⇒ commissions still accrue, silently, as before. */
  mail?: {
    enqueuePartnerEmail?(job: { kind: 'partner'; event: 'referral' | 'commission' | 'payout-request'; email: string; tenantId: string; locale: string; customer: string; amount?: string; portalUrl: string }): Promise<void>
  } | undefined
  /** Fired when a signature-verified subscription webhook provisioned NOTHING. Stripe is acked
   *  either way (a retry cannot conjure a missing customer mapping), so this counter is the only
   *  way anyone learns a paying customer is unprovisioned. */
  onWebhookUnmatched?: (reason: 'no_tenant' | 'unmappable') => void
  /** Re-register a restored tenant's devices in the ingest registry. Injected rather than imported
   *  so this route stays testable without Redis; absent ⇒ the daily sweep does it instead. */
  /**
   * Restore a suspended tenant's fleet. Typed as the REGISTRY's own row rather than an inline
   * structural copy: two copies of this shape existed and both silently accepted a row missing
   * `avlTable`, which a restore would then have written as "no dictionary" for the whole fleet.
   * A shape with a single owner cannot drift from it.
   */
  restoreDevices?: (devices: readonly TenantDeviceRow[]) => Promise<void>
  /** a suspended tenant paid and was restored on the spot */
  onTenantRestored?: () => void
}

// how long the per-tenant checkout-creation lock is held (audit LOW): long enough to serialize a
// double-click / concurrent-tab burst, short enough to not block a legitimate later re-subscribe.
const CHECKOUT_LOCK_TTL_S = 30

const ACTIVE = new Set(['active', 'trialing'])
/** Subscription statuses that mean the tenant has NO live subscription and may start a FRESH one.
 *  Everything else (active, trialing, but ALSO past_due, unpaid, incomplete, paused) is an EXISTING
 *  subscription — a payment problem is fixed in the Customer Portal, never by opening a second
 *  subscription (which would double-bill). Only a fully ended one is re-subscribable. */
const RESUBSCRIBABLE = new Set(['canceled', 'incomplete_expired'])
const hasLiveSubscription = (status: string | null | undefined): boolean => status != null && !RESUBSCRIBABLE.has(status)

/**
 * An F2 SELF-SERVE trial: we mint `trialing` locally at signup with NO Stripe subscription behind it.
 * A Stripe-side trial always carries a subscription id, so the absence of one is the discriminator.
 * Such a tenant has no live Stripe subscription to double-bill, and MUST be able to convert to paid —
 * without this the trial user hits `already_subscribed` (409) and can never subscribe.
 */
const isLocalTrial = (status: string | null | undefined, stripeSubscriptionId: string | null | undefined): boolean =>
  status === 'trialing' && (stripeSubscriptionId === null || stripeSubscriptionId === undefined)

/** The ONE predicate both GET /v1/billing (canSubscribe) and POST /checkout enforce. */
const canStartCheckout = (status: string | null | undefined, stripeSubscriptionId: string | null | undefined): boolean =>
  !hasLiveSubscription(status) || isLocalTrial(status, stripeSubscriptionId)

/** A safe absolute http(s) base URL from the configured value or the request Origin, else null. */
function baseUrl(configured: string | undefined, origin: string | undefined): string | null {
  const candidate = configured ?? origin
  if (candidate === undefined) return null
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

export function mountBilling(app: Hono<AuthEnv>, deps: BillingDeps): void {
  app.get('/v1/billing', async (c) => {
    const auth = c.get('auth')
    if (!isTenantWideAdmin(auth)) return problem(c, 403, 'Forbidden')
    c.header('Cache-Control', 'no-store')
    if (deps.stripe === undefined) {
      const view: BillingView = { configured: false, hasCustomer: false, status: null, active: false, currentPeriodEnd: null, suspendedAt: null, canSubscribe: false, localTrial: false, planPriceId: null }
      return c.json(view)
    }
    const b = await deps.db.tenants.getBilling(auth.tenantId)
    const view: BillingView = {
      configured: true,
      hasCustomer: b?.stripeCustomerId != null,
      status: b?.subscriptionStatus ?? null,
      active: b?.subscriptionStatus != null && ACTIVE.has(b.subscriptionStatus),
      currentPeriodEnd: b?.currentPeriodEnd ?? null,
      suspendedAt: b?.suspendedAt ?? null,
      // same predicate the checkout route enforces — the picker can never disagree with the API
      canSubscribe: canStartCheckout(b?.subscriptionStatus, b?.stripeSubscriptionId),
      localTrial: isLocalTrial(b?.subscriptionStatus, b?.stripeSubscriptionId),
      planPriceId: b?.subscriptionPriceId ?? null,
    }
    return c.json(view)
  })

  app.get('/v1/billing/plans', async (c) => {
    const auth = c.get('auth')
    if (!isTenantWideAdmin(auth)) return problem(c, 403, 'Forbidden')
    c.header('Cache-Control', 'no-store')
    if (deps.stripe === undefined) return c.json([] as BillingPlanView[])
    const plans = await deps.stripe.listPlans()
    return c.json(plans satisfies BillingPlanView[])
  })

  app.post('/v1/billing/checkout', async (c) => {
    const auth = c.get('auth')
    if (!isTenantWideAdmin(auth)) return problem(c, 403, 'Forbidden')
    if (deps.stripe === undefined) return problem(c, 503, 'Service Unavailable', 'billing_not_configured')
    const base = baseUrl(deps.appBaseUrl, c.req.header('origin'))
    if (base === null) return problem(c, 400, 'Bad Request', 'no_return_url')
    // the plan to subscribe to = a price id from the server allowlist; if exactly one is configured
    // it may be omitted (single-plan staging). An off-allowlist price is rejected (never trust the client).
    const body = (await c.req.json().catch(() => ({}))) as { priceId?: unknown }
    const prices = deps.stripe.prices
    const requested = typeof body.priceId === 'string' ? body.priceId : undefined
    const priceId = requested ?? (prices.length === 1 ? prices[0] : undefined)
    if (priceId === undefined || !prices.includes(priceId)) return problem(c, 400, 'Bad Request', 'invalid_price')

    const tenant = await deps.db.tenants.get(auth.tenantId)
    if (tenant === null) return problem(c, 404, 'Not Found')
    // never create a SECOND subscription for a tenant that already has a live one (double-billing
    // guard). Status is read server-side (never trusted from the browser). This covers not just
    // active/trialing but ALSO past_due/unpaid/incomplete/paused: those keep the existing
    // subscription, so the tenant is sent to the Customer Portal to FIX PAYMENT, not through
    // Checkout again. The UI reads `already_subscribed` → opens the portal (POST /v1/billing/portal).
    // …EXCEPT an F2 self-serve local trial (trialing with no Stripe subscription): it has nothing to
    // double-bill and must be able to convert to paid, so the same predicate GET /v1/billing reports
    // as `canSubscribe` decides here.
    if (!canStartCheckout(tenant.subscriptionStatus, tenant.stripeSubscriptionId)) return problem(c, 409, 'Conflict', 'already_subscribed')

    // TOCTOU mitigation (audit LOW): subscriptionStatus lags the webhook, so two CONCURRENT
    // checkouts both read "no live sub" and could each create a subscription. A per-tenant lock
    // held ONLY across the create critical section serializes that burst → the loser gets 409.
    // Held only during creation (not for the lock TTL) so a legitimate LATER re-subscribe after an
    // ended subscription is never blocked; the TTL is just a self-heal if the handler dies mid-flight.
    // Combined with the Stripe idempotency key below, a double-submit yields ONE session. Residual:
    // a fully SEQUENTIAL re-attempt during the webhook-lag window is not covered (would need a live
    // Stripe subscription-list read at checkout) — documented + accepted for a LOW.
    const lockKey = deps.redis !== undefined ? `billing:checkout:${tenant.id}` : null
    if (deps.redis !== undefined && lockKey !== null) {
      try {
        const locked = await deps.redis.set(lockKey, '1', 'EX', CHECKOUT_LOCK_TTL_S, 'NX')
        if (locked === null) return problem(c, 409, 'Conflict', 'checkout_in_progress')
      } catch {
        /* Redis blip — fall through (the idempotency key still guards a true double-submit) */
      }
    }
    try {
      const customerId = await deps.stripe.ensureCustomer({ tenantId: tenant.id, name: tenant.name, existingCustomerId: tenant.stripeCustomerId })
      if (tenant.stripeCustomerId !== customerId) await deps.db.tenants.setStripeCustomer(tenant.id, customerId)
      const url = await deps.stripe.createCheckoutSession({
        customerId,
        tenantId: tenant.id,
        priceId,
        successUrl: `${base}/app/billing?checkout=success`,
        cancelUrl: `${base}/app/billing?checkout=cancel`,
        // stable within a 30 s bucket so a rapid retry of the SAME plan dedupes to one Stripe session
        idempotencyKey: `co:${tenant.id}:${priceId}:${Math.floor(Date.now() / (CHECKOUT_LOCK_TTL_S * 1_000))}`,
      })
      return c.json({ url })
    } finally {
      if (deps.redis !== undefined && lockKey !== null) await deps.redis.del(lockKey).catch(() => undefined)
    }
  })

  app.post('/v1/billing/portal', async (c) => {
    const auth = c.get('auth')
    if (!isTenantWideAdmin(auth)) return problem(c, 403, 'Forbidden')
    if (deps.stripe === undefined) return problem(c, 503, 'Service Unavailable', 'billing_not_configured')
    const base = baseUrl(deps.appBaseUrl, c.req.header('origin'))
    if (base === null) return problem(c, 400, 'Bad Request', 'no_return_url')
    const b = await deps.db.tenants.getBilling(auth.tenantId)
    if (b?.stripeCustomerId == null) return problem(c, 409, 'Conflict', 'no_customer')
    const url = await deps.stripe.createPortalSession({ customerId: b.stripeCustomerId, returnUrl: `${base}/app/billing` })
    return c.json({ url })
  })

  /**
   * Change the plan of an existing subscription (TSP Start ⇄ Grow ⇄ Scale).
   *
   * The Stripe Customer Portal cannot do this for us: our subscriptions carry a paired metered
   * overage item its generic switcher ignores (it would leave the new base on the old overage
   * rate). So the swap is server-side, over both items, with proration. The webhook persists the
   * new plan and entitlements — this route does not touch the DB, exactly like checkout.
   */
  app.post('/v1/billing/change-plan', async (c) => {
    const auth = c.get('auth')
    if (!isTenantWideAdmin(auth)) return problem(c, 403, 'Forbidden')
    if (deps.stripe === undefined) return problem(c, 503, 'Service Unavailable', 'billing_not_configured')

    const body = (await c.req.json().catch(() => ({}))) as { priceId?: unknown }
    const priceId = typeof body.priceId === 'string' ? body.priceId : undefined
    // allowlisted base price, and one we can map to a plan AND a paired overage — an off-list or
    // Direct-only price never reaches Stripe (never trust the client)
    if (priceId === undefined || !deps.stripe.prices.includes(priceId)) return problem(c, 400, 'Bad Request', 'invalid_price')
    const targetPlan = deps.stripe.planFor(priceId)
    const overagePrice = deps.stripe.overageFor(priceId)
    if (targetPlan === undefined || isDirectPlan(targetPlan) || overagePrice === undefined) {
      // Direct plans have no metered overage and are not a reseller upgrade path; refuse rather
      // than build a malformed subscription
      return problem(c, 400, 'Bad Request', 'not_a_tsp_plan')
    }

    const b = await deps.db.tenants.getBilling(auth.tenantId)
    if (b?.stripeSubscriptionId == null) return problem(c, 409, 'Conflict', 'no_subscription')
    // no-op if they picked the plan they are already on (the UI hides it, but never trust the client)
    if (b.subscriptionPriceId === priceId) return problem(c, 409, 'Conflict', 'already_on_plan')

    try {
      await deps.stripe.changePlan({ subscriptionId: b.stripeSubscriptionId, newBasePriceId: priceId, newOveragePriceId: overagePrice })
    } catch (err) {
      // a Stripe-side failure (rejected proration, a subscription in a state the swap can't touch,
      // an API blip) used to become a bare 500 with nothing logged — the user saw "couldn't reach
      // Stripe" and we had no trace of why. Name it: this is money, and a silent failure here is the
      // difference between "the button is flaky" and a real diagnosis.
      console.error('billing change-plan failed', { tenantId: auth.tenantId, subscriptionId: b.stripeSubscriptionId, priceId, error: err instanceof Error ? err.message : String(err) })
      return problem(c, 502, 'Bad Gateway', 'change_plan_failed')
    }
    // the webhook writes the new plan; report success and let the client re-read GET /v1/billing
    return c.json({ ok: true })
  })

  /**
   * Preview the money impact of a plan change WITHOUT applying it — real prorated credit/charge/net
   * and the date they settle, so the confirm dialog shows numbers, not a promise. Same validation as
   * change-plan (allowlisted TSP price with a paired overage, an active subscription, not the current
   * plan); a preview that Stripe can't compute is a soft failure, not a 500.
   */
  app.get('/v1/billing/change-preview', async (c) => {
    const auth = c.get('auth')
    if (!isTenantWideAdmin(auth)) return problem(c, 403, 'Forbidden')
    if (deps.stripe === undefined) return problem(c, 503, 'Service Unavailable', 'billing_not_configured')

    const priceId = c.req.query('priceId')
    if (priceId === undefined || !deps.stripe.prices.includes(priceId)) return problem(c, 400, 'Bad Request', 'invalid_price')
    const targetPlan = deps.stripe.planFor(priceId)
    const overagePrice = deps.stripe.overageFor(priceId)
    if (targetPlan === undefined || isDirectPlan(targetPlan) || overagePrice === undefined) return problem(c, 400, 'Bad Request', 'not_a_tsp_plan')

    const b = await deps.db.tenants.getBilling(auth.tenantId)
    if (b?.stripeSubscriptionId == null) return problem(c, 409, 'Conflict', 'no_subscription')
    if (b.subscriptionPriceId === priceId) return problem(c, 409, 'Conflict', 'already_on_plan')

    try {
      const preview = await deps.stripe.previewChange({ subscriptionId: b.stripeSubscriptionId, newBasePriceId: priceId, newOveragePriceId: overagePrice })
      return c.json(preview satisfies PlanChangePreviewView)
    } catch (err) {
      console.error('billing change-preview failed', { tenantId: auth.tenantId, priceId, error: err instanceof Error ? err.message : String(err) })
      return problem(c, 502, 'Bad Gateway', 'preview_failed')
    }
  })

  /**
   * Live billing details for the advanced page: current period, upcoming invoice total, the card on
   * file, and the overage rate. Everything is null when there is no active subscription, so the page
   * degrades cleanly rather than erroring.
   */
  app.get('/v1/billing/details', async (c) => {
    const auth = c.get('auth')
    if (!isTenantWideAdmin(auth)) return problem(c, 403, 'Forbidden')
    c.header('Cache-Control', 'no-store')
    const empty: BillingDetailsView = { periodStart: null, periodEnd: null, upcomingTotal: null, currency: null, paymentMethod: null, overagePerDeviceDay: null }
    if (deps.stripe === undefined) return c.json(empty)
    const b = await deps.db.tenants.getBilling(auth.tenantId)
    if (b?.stripeSubscriptionId == null || b.stripeCustomerId == null) return c.json(empty)
    try {
      const details = await deps.stripe.billingDetails({
        subscriptionId: b.stripeSubscriptionId,
        customerId: b.stripeCustomerId,
        overagePriceId: b.subscriptionPriceId != null ? deps.stripe.overageFor(b.subscriptionPriceId) : undefined,
      })
      return c.json(details satisfies BillingDetailsView)
    } catch (err) {
      // a live-Stripe read failing must not blank the whole billing page — degrade to empties
      console.error('billing details failed', { tenantId: auth.tenantId, error: err instanceof Error ? err.message : String(err) })
      return c.json(empty)
    }
  })
}

/** The BASE (licensed) price id from a subscription's items = the one on the server allowlist
 *  (the metered overage price is never allowlisted). Null if none matches. */
function basePriceIdOf(obj: Record<string, unknown>, allowlist: readonly string[]): string | null {
  const items = obj['items']
  const data = typeof items === 'object' && items !== null && 'data' in items ? (items as { data?: unknown }).data : undefined
  if (!Array.isArray(data)) return null
  for (const item of data) {
    const price = (item as { price?: unknown }).price
    const pid = typeof price === 'object' && price !== null && 'id' in price ? (price as { id?: unknown }).id : undefined
    if (typeof pid === 'string' && allowlist.includes(pid)) return pid
  }
  return null
}

/** current_period_end (Unix seconds → UTC instant). Reads the subscription top-level (older API) OR,
 *  since Stripe `2025-03-31.basil`, the per-item `current_period_end` (max across items). */
function periodEndOf(obj: Record<string, unknown>): Date | null {
  if (typeof obj['current_period_end'] === 'number') return new Date(obj['current_period_end'] * 1000)
  const items = obj['items']
  const data = typeof items === 'object' && items !== null && 'data' in items ? (items as { data?: unknown }).data : undefined
  if (!Array.isArray(data)) return null
  let maxSec = 0
  for (const item of data) {
    const v = (item as { current_period_end?: unknown }).current_period_end
    if (typeof v === 'number' && v > maxSec) maxSec = v
  }
  return maxSec > 0 ? new Date(maxSec * 1000) : null
}

/** Map a Stripe subscription resource → the fields we persist, keyed by its customer id. */
function subscriptionFrom(obj: Record<string, unknown>, allowlist: readonly string[]): { customerId: string; update: SubscriptionUpdate } | null {
  // treat an empty/absent customer as no-match (never let '' reach a query)
  const customerId = typeof obj['customer'] === 'string' && obj['customer'] !== '' ? obj['customer'] : null
  if (customerId === null) return null
  const id = typeof obj['id'] === 'string' ? obj['id'] : null
  const status = typeof obj['status'] === 'string' ? obj['status'] : null
  return { customerId, update: { stripeSubscriptionId: id, subscriptionStatus: status, subscriptionPriceId: basePriceIdOf(obj, allowlist), currentPeriodEnd: periodEndOf(obj) } }
}

const SUBSCRIPTION_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'])

/** Map a Stripe Invoice resource → the fields the affiliate accrual needs. Null when any required
 *  field is missing/zero (a $0 invoice owes no commission) so we never accrue on garbage. */
function paidInvoiceFrom(obj: Record<string, unknown>, paidAt: Date): PaidInvoice | null {
  const stripeCustomerId = typeof obj['customer'] === 'string' && obj['customer'] !== '' ? obj['customer'] : null
  const invoiceId = typeof obj['id'] === 'string' && obj['id'] !== '' ? obj['id'] : null
  const amountPaidCents = typeof obj['amount_paid'] === 'number' ? obj['amount_paid'] : 0
  const currency = typeof obj['currency'] === 'string' && obj['currency'] !== '' ? obj['currency'] : 'eur'
  if (stripeCustomerId === null || invoiceId === null || amountPaidCents <= 0) return null
  return { stripeCustomerId, invoiceId, amountPaidCents, currency, paidAt }
}

/**
 * "You earned X" — fire-and-forget, outside the webhook's success path.
 *
 * Every lookup it needs (the partner's address, the customer's name) is a read the accrual did not
 * have to do, so it happens here rather than widening the money path. Any failure is logged and
 * dropped: the commission is already recorded, and that is the part that must survive.
 */
async function notifyPartnerOfCommission(deps: BillingDeps, commission: { affiliateId: string; tenantId: string; amountCents: number; currency: string }): Promise<void> {
  try {
    // bound to its object: the lint rule is right that a detached method loses `this`, and the
    // queue closure this resolves to in main.ts genuinely captures one
    const enqueue = deps.mail?.enqueuePartnerEmail?.bind(deps.mail)
    if (enqueue === undefined || deps.siteUrl === undefined) return
    const [affiliate, tenant] = await Promise.all([
      deps.db.affiliates.get(commission.affiliateId),
      deps.db.tenants.get(commission.tenantId),
    ])
    if (affiliate === null || affiliate.status !== 'active') return // a suspended partner is not being told about money
    await enqueue({
      kind: 'partner',
      event: 'commission',
      email: affiliate.email,
      tenantId: '', // platform-branded; see the job's doc comment
      locale: affiliate.locale, // the PARTNER's language
      customer: tenant?.name ?? '',
      // formatted in the PARTNER's locale, so "€90.00" and "90,00 €" match the language of the
      // sentence they land in rather than always reading as English
      amount: new Intl.NumberFormat(affiliate.locale, { style: 'currency', currency: commission.currency.toUpperCase() }).format(commission.amountCents / 100),
      portalUrl: `${deps.siteUrl.replace(/\/+$/, '')}/partner/dashboard`,
    })
  } catch (err) {
    deps.onPartnerMailFailed?.()
    console.warn('commission notice not queued', err instanceof Error ? err.message : String(err))
  }
}

/**
 * PUBLIC Stripe webhook — MUST be registered before the /v1/* auth guard (Stripe carries no JWT).
 * The raw body is required for signature verification; an invalid signature ⇒ 400 with NO state
 * change. Ordering/idempotency is enforced in the DB write (applySubscriptionEvent's atomic
 * monotonic guard by event timestamp), so out-of-order and replayed deliveries are safe and there
 * is no mark-before-process gap: if the write throws we return non-2xx and Stripe retries.
 * Subscription lifecycle events are the ONLY trusted source of `subscriptionStatus`.
 */
export function mountStripeWebhook(app: Hono<AuthEnv>, deps: BillingDeps): void {
  app.post('/v1/webhooks/stripe', async (c) => {
    if (deps.stripe === undefined) return c.text('billing not configured', 503)
    const sig = c.req.header('stripe-signature')
    if (sig === undefined) return c.text('missing signature', 400)
    const raw = await c.req.text()
    let event
    try {
      event = deps.stripe.constructEvent(raw, sig)
    } catch {
      return c.text('invalid signature', 400)
    }
    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const mapped = subscriptionFrom(event.data.object, deps.stripe.prices)
      // event.created is the Unix-SECONDS ordering key. The DB guard applies a strictly newer event
      // unconditionally, and an equal-second one by event type rank (see applySubscriptionEvent);
      // a redelivery of an already-applied event id is dropped there whatever its timestamp.
      if (mapped === null) {
        // an unmappable subscription payload — we cannot provision anything from it. Ack (retrying
        // will not make it mappable) but SAY SO: silence here means a paying customer sits
        // unprovisioned with no trace anywhere. See the applied === false branch below.
        console.error('stripe webhook: unmappable subscription payload', { type: event.type, id: event.id })
        deps.onWebhookUnmatched?.('unmappable')
      }
      if (mapped !== null) {
        // resolve the entitlement tier from the (allowlisted) base price id — this is the ONLY place
        // the tenant plan is written, and only from the signature-verified webhook (never the browser).
        // planFor undefined (unmapped/unknown price) ⇒ leave plan unchanged; the monotonic guard in
        // applySubscriptionEvent handles ordering. Covers both Direct + TSP checkout (same map).
        const incomingLive = mapped.update.subscriptionStatus === 'active' || mapped.update.subscriptionStatus === 'trialing'
        const basePriceId = mapped.update.subscriptionPriceId
        const plan = basePriceId != null ? deps.stripe.planFor(basePriceId) : undefined
        if (plan !== undefined) mapped.update.plan = plan
        // applySubscriptionEvent returns false when it matched NO tenant row — the repo returns it
        // precisely so the caller can tell "applied" from "matched nothing", and the caller was
        // discarding it. Stripe sees 200, never retries, and a paying customer stays unprovisioned
        // forever with no log and no metric. Reachable for real: checkout creates the Stripe
        // customer and persists it in two steps, and the per-tenant lock around them falls through
        // on a Redis blip, so two concurrent checkouts can leave a customer id we never stored.
        // Still a 200 — a retry cannot fix a missing mapping, and a 500 would make Stripe hammer
        // the endpoint for days — but now it is loud. Audit MED.
        // The whole event identity goes to the repo, not just its timestamp: `event.created` is
        // second-granularity and Stripe emits `.updated` + `.deleted` for one cancel in the same
        // second, so ordering needs the TYPE, and suppressing a retry needs the ID (audit MED #25).
        const outcome = await deps.db.tenants.applySubscriptionEvent(
          { stripeCustomerId: mapped.customerId, id: event.id, type: event.type, at: new Date(event.created * 1000) },
          mapped.update,
        )
        // `stale` is NORMAL — the monotonic and per-subscription guards drop replayed and
        // out-of-order deliveries by design. Only `no_tenant` means a paying customer has no plan.
        // RESTORE ON PAYMENT (audit MED #22). The daily sweep also un-suspends, but daily is not an
        // acceptable wait for someone who has just paid to get their fleet back — this is the path
        // that makes suspension feel reversible rather than punitive. Best-effort: a failure here
        // must not turn a signature-verified webhook into a retry storm, and the sweep repairs it.
        if (outcome === 'applied' && incomingLive) {
          try {
            const tenantId = await deps.db.tenants.tenantIdForCustomer(mapped.customerId)
            // ORDER IS THE WHOLE THING, and it is the same order the sweep uses: rebuild the
            // registry FIRST, clear the flag SECOND. Clearing first and then failing the Redis write
            // leaves the tenant marked not-suspended with a dark fleet — invisible to `listSuspended`
            // (not suspended) AND to `listLapsedTenants` (they paid), so no pass ever looks at them
            // again and only an API restart repairs it. This way a failure leaves them marked
            // suspended with a working feed, which tomorrow's sweep simply finishes.
            if (tenantId !== null && (await deps.db.tenants.isSuspended(tenantId))) {
              const devices = await deps.db.tenants.registryDevicesFor(tenantId)
              await deps.restoreDevices?.(devices)
              await deps.db.tenants.unsuspend(tenantId)
              console.warn('billing: restored a suspended tenant on payment', JSON.stringify({ tenantId, devices: devices.length }))
              deps.onTenantRestored?.()
            }
          } catch (err) {
            console.error('billing: restore-on-payment failed', err instanceof Error ? err.message : String(err))
          }
        }
        if (outcome === 'no_tenant') {
          console.error('stripe webhook: no tenant for customer — subscription NOT applied', {
            type: event.type,
            id: event.id,
            customerId: mapped.customerId,
          })
          deps.onWebhookUnmatched?.('no_tenant')
        }
      }
    } else if (event.type === 'invoice.payment_succeeded') {
      // affiliate commissions (F4): a referred tenant paid → accrue the partner's cut. BEST-EFFORT —
      // a failure here must NOT 500 the webhook (that would make Stripe retry the whole event and, more
      // importantly, isn't the authoritative subscription path). Idempotent on the invoice id, so the
      // occasional retry is safe. The repo owns the referral/window/rate resolution (rule 2).
      const paid = paidInvoiceFrom(event.data.object, new Date(event.created * 1000))
      if (paid !== null) {
        try {
          // returns null for a dedupe / nothing-owed (both fine, ack 200); THROWS only on a genuine
          // fault (the repo no longer swallows non-dedupe errors)
          const commission = await deps.db.affiliates.accrueForPaidInvoice(paid)
          // TELL THE PARTNER they earned. This is the message that makes someone refer a second
          // time, and until now nothing reached them at all. Strictly best-effort: a mail failure
          // must never make Stripe retry an accrual that already succeeded — the retry is idempotent
          // but it would re-send the notice, and a partner told twice about one payment stops
          // trusting the numbers.
          if (commission !== null) void notifyPartnerOfCommission(deps, commission)
        } catch (err) {
          // a real fault (e.g. transient DB error). Return non-2xx so Stripe RETRIES this invoice —
          // accrual is idempotent, so the retry recovers the commission instead of losing it forever
          // (a 200 here would be final). This branch is isolated from the authoritative subscription.*.
          console.error('affiliate commission accrual failed', paid.invoiceId, err)
          return c.text('accrual failed', 500)
        }
      }
    } else if (event.type === 'charge.refunded') {
      // The commission mirror of the accrual above: we paid a partner a cut of a payment that the
      // customer has now got back. Without this the ledger keeps showing money owed on a sale that
      // was undone, and the partner portal states — in writing — that a refund reverses the
      // commission. Only a FULL refund reverses: a partial one leaves a commission that is merely
      // too large, which is an arithmetic judgement (which line? what proportion?) rather than a
      // cancellation, so it is logged for a human instead of guessed at.
      const obj = event.data.object
      const invoiceId = typeof obj['invoice'] === 'string' && obj['invoice'] !== '' ? obj['invoice'] : null
      const customerId = typeof obj['customer'] === 'string' ? obj['customer'] : ''
      const full = obj['refunded'] === true
      if (invoiceId !== null) {
        try {
          if (full) {
            const outcome = await deps.db.affiliates.voidCommissionForRefund(invoiceId, customerId)
            if (outcome === 'alreadyPaid') {
              // deliberately loud: the partner has the cash and the sale is reversed. Nothing here
              // can fix that, and pretending otherwise by voiding the row would hide it. The repo
              // also writes an audit row, so this survives the log buffer.
              console.warn('commission already PAID OUT on a refunded invoice — manual clawback', invoiceId)
            } else if (outcome === 'tombstoned') {
              // the refund overtook its own accrual; the tombstone stops the retry from paying out
              console.warn('refund arrived before accrual — commission blocked for invoice', invoiceId)
            }
          } else {
            console.warn('partial refund on an invoice with a commission — review manually', invoiceId)
          }
        } catch (err) {
          // same contract as accrual: a genuine fault returns non-2xx so Stripe retries. The void is
          // idempotent, so the retry is safe.
          console.error('commission reversal failed', invoiceId, err)
          return c.text('reversal failed', 500)
        }
      }
    }
    // other event types (checkout.session.completed, invoice.payment_failed, …) are acked; the
    // subscription.* events remain authoritative for plan/status.
    return c.text('ok', 200)
  })
}
