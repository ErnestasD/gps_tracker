import type { Hono } from 'hono'

import type { Db, SubscriptionUpdate } from '@orbetra/db'
import type { BillingPlanView, BillingView, Role } from '@orbetra/shared'

import type { StripeGateway } from '../billing/stripe.js'
import { problem, type AuthEnv } from '../auth/middleware.js'

/**
 * Billing API (Stripe, ADR-024). Tenant-self routes — tenant is taken from the JWT, NEVER a param
 * — so these are manifest-exempt with a dedicated isolation test. Billing data + actions are
 * admin-only (matches `usage`). When the Stripe gateway is absent (no server keys) every route
 * degrades to a clear signal: GET reports `configured:false`, mutations 503. Subscription STATE is
 * written ONLY by the signature-verified webhook — the browser is never trusted to report payment.
 */
const TENANT_ADMINS: Role[] = ['platform_admin', 'tsp_admin']
const isAdmin = (role: Role): boolean => TENANT_ADMINS.includes(role)

export interface BillingDeps {
  db: Db
  stripe?: StripeGateway | undefined
  /** absolute base for Checkout success/cancel + portal return; falls back to the request Origin */
  appBaseUrl?: string | undefined
}

const ACTIVE = new Set(['active', 'trialing'])

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
    if (!isAdmin(auth.role)) return problem(c, 403, 'Forbidden')
    c.header('Cache-Control', 'no-store')
    if (deps.stripe === undefined) {
      const view: BillingView = { configured: false, hasCustomer: false, status: null, active: false, currentPeriodEnd: null }
      return c.json(view)
    }
    const b = await deps.db.tenants.getBilling(auth.tenantId)
    const view: BillingView = {
      configured: true,
      hasCustomer: b?.stripeCustomerId != null,
      status: b?.subscriptionStatus ?? null,
      active: b?.subscriptionStatus != null && ACTIVE.has(b.subscriptionStatus),
      currentPeriodEnd: b?.currentPeriodEnd ?? null,
    }
    return c.json(view)
  })

  app.get('/v1/billing/plans', async (c) => {
    const auth = c.get('auth')
    if (!isAdmin(auth.role)) return problem(c, 403, 'Forbidden')
    c.header('Cache-Control', 'no-store')
    if (deps.stripe === undefined) return c.json([] as BillingPlanView[])
    const plans = await deps.stripe.listPlans()
    return c.json(plans satisfies BillingPlanView[])
  })

  app.post('/v1/billing/checkout', async (c) => {
    const auth = c.get('auth')
    if (!isAdmin(auth.role)) return problem(c, 403, 'Forbidden')
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
    // never create a SECOND subscription for an already-subscribed tenant (double-billing guard):
    // an active/trialing tenant is sent to the portal to manage, not through Checkout again
    if (tenant.subscriptionStatus != null && ACTIVE.has(tenant.subscriptionStatus)) return problem(c, 409, 'Conflict', 'already_subscribed')
    const customerId = await deps.stripe.ensureCustomer({ tenantId: tenant.id, name: tenant.name, existingCustomerId: tenant.stripeCustomerId })
    if (tenant.stripeCustomerId !== customerId) await deps.db.tenants.setStripeCustomer(tenant.id, customerId)
    const url = await deps.stripe.createCheckoutSession({
      customerId,
      tenantId: tenant.id,
      priceId,
      successUrl: `${base}/app/billing?checkout=success`,
      cancelUrl: `${base}/app/billing?checkout=cancel`,
    })
    return c.json({ url })
  })

  app.post('/v1/billing/portal', async (c) => {
    const auth = c.get('auth')
    if (!isAdmin(auth.role)) return problem(c, 403, 'Forbidden')
    if (deps.stripe === undefined) return problem(c, 503, 'Service Unavailable', 'billing_not_configured')
    const base = baseUrl(deps.appBaseUrl, c.req.header('origin'))
    if (base === null) return problem(c, 400, 'Bad Request', 'no_return_url')
    const b = await deps.db.tenants.getBilling(auth.tenantId)
    if (b?.stripeCustomerId == null) return problem(c, 409, 'Conflict', 'no_customer')
    const url = await deps.stripe.createPortalSession({ customerId: b.stripeCustomerId, returnUrl: `${base}/app/billing` })
    return c.json({ url })
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
      // event.created is the Unix-seconds ordering key; the DB guard applies it only if strictly newer
      if (mapped !== null) await deps.db.tenants.applySubscriptionEvent(mapped.customerId, new Date(event.created * 1000), mapped.update)
    }
    // other event types (checkout.session.completed, invoice.*) are acked; subscription.* is authoritative
    return c.text('ok', 200)
  })
}
