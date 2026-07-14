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

export interface StripeGateway {
  /** The server-configured allowlist of subscribable price ids (a client may only check out one of these). */
  readonly prices: readonly string[]
  /** Return the existing customer id, or create one for the tenant. */
  ensureCustomer(opts: { tenantId: string; name: string; email?: string; existingCustomerId?: string | null }): Promise<string>
  /** Create a subscription Checkout Session for the chosen price; returns the hosted URL to redirect to. */
  createCheckoutSession(opts: { customerId: string; tenantId: string; priceId: string; successUrl: string; cancelUrl: string }): Promise<string>
  /** Create a Customer Portal session; returns the hosted URL. */
  createPortalSession(opts: { customerId: string; returnUrl: string }): Promise<string>
  /** Verify the webhook signature and parse the event. THROWS on an invalid signature. */
  constructEvent(rawBody: string, signature: string): StripeEvent
}

export interface StripeConfig {
  secretKey: string
  webhookSecret: string
  /** Allowlist of subscribable Stripe price ids (`price_…`). Two-track catalog per PRICING_STRATEGY.md
   *  §7 (Direct flat tiers + TSP base/overage). The exact price↔plan mapping lives client-side / PR B;
   *  here we only enforce that a checkout targets a configured price. */
  priceIds: string[]
}

/** Build config from env, or null when billing is not configured (no keys ⇒ routes 503).
 *  STRIPE_PRICES is a comma-separated allowlist of price ids. */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env['STRIPE_SECRET_KEY']
  const webhookSecret = env['STRIPE_WEBHOOK_SECRET']
  const priceIds = (env['STRIPE_PRICES'] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (!secretKey || !webhookSecret || priceIds.length === 0) return null
  return { secretKey, webhookSecret, priceIds }
}

export function createStripeGateway(cfg: StripeConfig): StripeGateway {
  const stripe = new Stripe(cfg.secretKey)
  return {
    prices: cfg.priceIds,
    ensureCustomer: async ({ tenantId, name, email, existingCustomerId }) => {
      if (existingCustomerId) return existingCustomerId
      const customer = await stripe.customers.create({ name, ...(email ? { email } : {}), metadata: { tenantId } })
      return customer.id
    },
    createCheckoutSession: async ({ customerId, tenantId, priceId, successUrl, cancelUrl }) => {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        // Direct plans are flat (quantity 1); TSP base likewise. Metered overage is added in PR B.
        line_items: [{ price: priceId, quantity: 1 }],
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
