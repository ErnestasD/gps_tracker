import Stripe from 'stripe'

/**
 * Stripe gateway (ADR-024). A THIN interface over just the Stripe calls billing uses, so the
 * API depends on this — not the SDK — and tests inject a fake (no network, no keys). The real
 * implementation wraps the official `stripe` SDK; webhook signature verification uses the SDK's
 * timing-safe `constructEvent` (never hand-rolled). Absent env config ⇒ the gateway is undefined
 * and the billing routes 503 (staging/CI run keyless).
 */

/** The minimal event shape billing reads. `object` is the Stripe resource (subscription/session/invoice).
 *  `created` is the event's Unix timestamp (seconds) — the monotonic ordering key for the webhook. */
export interface StripeEvent {
  id: string
  type: string
  created: number
  data: { object: Record<string, unknown> }
}

/** A subscribable plan, resolved from a Stripe price (+ its product) for the plan picker. */
export interface StripePlan {
  priceId: string
  productName: string
  /** amount in the currency's minor unit (cents), or null for a metered/free price */
  amount: number | null
  currency: string
  /** 'month' | 'year' for a recurring price */
  interval: string | null
}

export interface StripeGateway {
  /** The server-configured allowlist of subscribable price ids (a client may only check out one of these). */
  readonly prices: readonly string[]
  /** Resolve the allowlisted prices (+ product names/amounts) for the plan picker. */
  listPlans(): Promise<StripePlan[]>
  /** Return the existing customer id, or create one for the tenant. */
  ensureCustomer(opts: { tenantId: string; name: string; email?: string; existingCustomerId?: string | null }): Promise<string>
  /** Create a subscription Checkout Session for the chosen price; returns the hosted URL to redirect to. */
  createCheckoutSession(opts: { customerId: string; tenantId: string; priceId: string; successUrl: string; cancelUrl: string }): Promise<string>
  /** Create a Customer Portal session; returns the hosted URL. */
  createPortalSession(opts: { customerId: string; returnUrl: string }): Promise<string>
  /** Verify the webhook signature and parse the event. THROWS on an invalid signature. */
  constructEvent(rawBody: string, signature: string): StripeEvent
  /** The metered overage price id for a base plan (TSP), or undefined (Direct plans have none). */
  overageFor(basePriceId: string): string | undefined
  /** Included device count for a base plan (TSP), or undefined (Direct plans have no overage). */
  includedFor(basePriceId: string): number | undefined
  /** Report device-day usage to the overage meter (PR B2). value = excess devices for a day. */
  reportUsage(opts: { customerId: string; value: number; timestampS: number }): Promise<void>
}

export interface StripeConfig {
  secretKey: string
  webhookSecret: string
  /** Allowlist of subscribable Stripe BASE price ids (`price_…`). Two-track catalog per
   *  PRICING_STRATEGY.md §7 (Direct flat tiers + TSP base). */
  priceIds: string[]
  /** base price id → metered overage price id (TSP only). */
  overageMap: Record<string, string>
  /** base price id → included device count (TSP only). */
  includedMap: Record<string, number>
  /** the meter event name (matches the Stripe meter); default `orbetra_device_overage`. */
  meterEvent: string
}

/** Parse a `a:b,c:d` env pair-map; `valueOf` coerces the value half. */
function parsePairMap<T>(raw: string | undefined, valueOf: (v: string) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {}
  for (const pair of (raw ?? '').split(',')) {
    const [k, v] = pair.split(':').map((s) => s.trim())
    if (k === undefined || k === '' || v === undefined || v === '') continue
    const val = valueOf(v)
    if (val !== undefined) out[k] = val
  }
  return out
}

/** Build config from env, or null when billing is not configured (no keys ⇒ routes 503).
 *  STRIPE_PRICES = allowlist; STRIPE_OVERAGE_MAP = base:overage,…; STRIPE_INCLUDED = base:count,…. */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env['STRIPE_SECRET_KEY']
  const webhookSecret = env['STRIPE_WEBHOOK_SECRET']
  const priceIds = (env['STRIPE_PRICES'] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (!secretKey || !webhookSecret || priceIds.length === 0) return null
  return {
    secretKey,
    webhookSecret,
    priceIds,
    overageMap: parsePairMap(env['STRIPE_OVERAGE_MAP'], (v) => v),
    includedMap: parsePairMap(env['STRIPE_INCLUDED'], (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined }),
    meterEvent: env['STRIPE_METER_EVENT'] ?? 'orbetra_device_overage',
  }
}

export function createStripeGateway(cfg: StripeConfig): StripeGateway {
  const stripe = new Stripe(cfg.secretKey)
  return {
    prices: cfg.priceIds,
    listPlans: async () => {
      // resolve each allowlisted price (+ its product) in parallel; a deleted/invalid id is dropped
      const settled = await Promise.allSettled(cfg.priceIds.map((id) => stripe.prices.retrieve(id, { expand: ['product'] })))
      const plans: StripePlan[] = []
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue
        const p = r.value
        const product = typeof p.product === 'object' && p.product !== null && 'name' in p.product ? (p.product as { name?: string }).name : undefined
        plans.push({
          priceId: p.id,
          productName: product ?? 'Plan',
          amount: p.unit_amount ?? null,
          currency: p.currency,
          interval: p.recurring?.interval ?? null,
        })
      }
      return plans
    },
    ensureCustomer: async ({ tenantId, name, email, existingCustomerId }) => {
      if (existingCustomerId) return existingCustomerId
      const customer = await stripe.customers.create({ name, ...(email ? { email } : {}), metadata: { tenantId } })
      return customer.id
    },
    overageFor: (basePriceId) => cfg.overageMap[basePriceId],
    includedFor: (basePriceId) => cfg.includedMap[basePriceId],
    reportUsage: async ({ customerId, value, timestampS }) => {
      await stripe.billing.meterEvents.create({
        event_name: cfg.meterEvent,
        // meter value must be a string; the meter maps customers by stripe_customer_id
        payload: { value: String(value), stripe_customer_id: customerId },
        timestamp: timestampS,
      })
    },
    createCheckoutSession: async ({ customerId, tenantId, priceId, successUrl, cancelUrl }) => {
      // TSP plans carry a metered overage price as a 2nd line item (no quantity — usage-reported);
      // Direct plans have none. The base is always flat quantity 1.
      const overage = cfg.overageMap[priceId]
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: priceId, quantity: 1 }]
      if (overage !== undefined) lineItems.push({ price: overage })
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: tenantId,
        subscription_data: { metadata: { tenantId } },
      })
      if (!session.url) throw new Error('stripe checkout session returned no url')
      return session.url
    },
    createPortalSession: async ({ customerId, returnUrl }) => {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })
      return session.url
    },
    constructEvent: (rawBody, signature) =>
      stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret) as unknown as StripeEvent,
  }
}
