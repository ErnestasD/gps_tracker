import type { Hono } from 'hono'
import type { Redis } from 'ioredis'

import type { Db, SubscriptionUpdate } from '@orbetra/db'
import type { BillingView, Role } from '@orbetra/shared'

import type { StripeGateway } from '../billing/stripe.js'
import { type AuthEnv } from '../auth/middleware.js'

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
  redis: Redis
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
    if (!isAdmin(auth.role)) return c.json({ error: 'Forbidden' }, 403)
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

  app.post('/v1/billing/checkout', async (c) => {
    const auth = c.get('auth')
    if (!isAdmin(auth.role)) return c.json({ error: 'Forbidden' }, 403)
    if (deps.stripe === undefined) return c.json({ error: 'billing_not_configured' }, 503)
    const base = baseUrl(deps.appBaseUrl, c.req.header('origin'))
    if (base === null) return c.json({ error: 'no_return_url' }, 400)
    const tenant = await deps.db.tenants.get(auth.tenantId)
    if (tenant === null) return c.json({ error: 'Not Found' }, 404)
    const customerId = await deps.stripe.ensureCustomer({ tenantId: tenant.id, name: tenant.name, existingCustomerId: tenant.stripeCustomerId })
    if (tenant.stripeCustomerId !== customerId) await deps.db.tenants.setStripeCustomer(tenant.id, customerId)
    const url = await deps.stripe.createCheckoutSession({
      customerId,
      tenantId: tenant.id,
      successUrl: `${base}/app/billing?checkout=success`,
      cancelUrl: `${base}/app/billing?checkout=cancel`,
    })
    return c.json({ url })
  })

  app.post('/v1/billing/portal', async (c) => {
    const auth = c.get('auth')
    if (!isAdmin(auth.role)) return c.json({ error: 'Forbidden' }, 403)
    if (deps.stripe === undefined) return c.json({ error: 'billing_not_configured' }, 503)
    const base = baseUrl(deps.appBaseUrl, c.req.header('origin'))
    if (base === null) return c.json({ error: 'no_return_url' }, 400)
    const b = await deps.db.tenants.getBilling(auth.tenantId)
    if (b?.stripeCustomerId == null) return c.json({ error: 'no_customer' }, 409)
    const url = await deps.stripe.createPortalSession({ customerId: b.stripeCustomerId, returnUrl: `${base}/app/billing` })
    return c.json({ url })
  })
}

/** Map a Stripe subscription resource → the fields we persist, keyed by its customer id. */
function subscriptionFrom(obj: Record<string, unknown>): { customerId: string; update: SubscriptionUpdate } | null {
  const customerId = typeof obj['customer'] === 'string' ? obj['customer'] : null
  if (customerId === null) return null
  const id = typeof obj['id'] === 'string' ? obj['id'] : null
  const status = typeof obj['status'] === 'string' ? obj['status'] : null
  // current_period_end is a Unix timestamp (seconds); a UTC instant, stored as timestamptz
  const cpe = typeof obj['current_period_end'] === 'number' ? new Date(obj['current_period_end'] * 1000) : null
  return { customerId, update: { stripeSubscriptionId: id, subscriptionStatus: status, currentPeriodEnd: cpe } }
}

/**
 * PUBLIC Stripe webhook — MUST be registered before the /v1/* auth guard (Stripe carries no JWT).
 * The raw body is required for signature verification; an invalid signature ⇒ 400 with NO state
 * change. Idempotent: a processed event id is a no-op (Redis SETNX). Subscription lifecycle events
 * are the ONLY trusted source of `subscriptionStatus`.
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
    // idempotency: drop replays (Stripe retries until 2xx) — first writer wins for 24h
    const fresh = await deps.redis.set(`stripe:evt:${event.id}`, '1', 'EX', 86_400, 'NX')
    if (fresh === null) return c.text('duplicate', 200)

    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const mapped = subscriptionFrom(event.data.object)
      if (mapped !== null) await deps.db.tenants.applySubscriptionEvent(mapped.customerId, mapped.update)
    }
    // other event types (checkout.session.completed, invoice.*) are acked; subscription.* is authoritative
    return c.text('ok', 200)
  })
}
