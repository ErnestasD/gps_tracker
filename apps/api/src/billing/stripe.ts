import Stripe from 'stripe'

import { tenantPlanSchema, type TenantPlan } from '@orbetra/shared'

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
  /** the TenantPlan key this base price maps to (planMap), or null if unmapped */
  plan: TenantPlan | null
}

/** The prorated money impact of a plan change (all amounts in minor units / cents). */
export interface PlanChangePreview {
  /** unused time on the current plan, credited back — ≤ 0 */
  credit: number
  /** remaining time on the target plan — ≥ 0 */
  charge: number
  /** credit + charge: > 0 the customer pays extra, < 0 they are credited */
  net: number
  currency: string
  /** ISO instant the net settles onto the next invoice (renewal), or null */
  nextInvoiceDate: string | null
}

/** Live Stripe reads for the advanced billing page. */
export interface BillingLiveDetails {
  /** current billing period bounds (ISO), from the subscription item */
  periodStart: string | null
  periodEnd: string | null
  /** the forthcoming invoice's total in minor units + its currency, or null if none */
  upcomingTotal: number | null
  currency: string | null
  /** the default card on file, or null */
  paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null
  /** the overage price per device-day in minor units (unit_amount_decimal), or null */
  overagePerDeviceDay: number | null
}

export interface StripeGateway {
  /** The server-configured allowlist of subscribable price ids (a client may only check out one of these). */
  readonly prices: readonly string[]
  /** Resolve the allowlisted prices (+ product names/amounts) for the plan picker. */
  listPlans(): Promise<StripePlan[]>
  /** Return the existing customer id, or create one for the tenant. */
  ensureCustomer(opts: { tenantId: string; name: string; email?: string; existingCustomerId?: string | null }): Promise<string>
  /** Create a subscription Checkout Session for the chosen price; returns the hosted URL to redirect to.
   *  `idempotencyKey` (audit LOW) dedupes near-simultaneous identical checkout creations so a
   *  double-submit yields ONE session, not two subscriptions on the one customer. */
  createCheckoutSession(opts: { customerId: string; tenantId: string; priceId: string; successUrl: string; cancelUrl: string; idempotencyKey?: string }): Promise<string>
  /** Create a Customer Portal session; returns the hosted URL. */
  createPortalSession(opts: { customerId: string; returnUrl: string }): Promise<string>
  /**
   * Move an existing subscription to a different TSP plan, swapping BOTH line items — the base
   * (licensed) price AND its paired metered overage — with proration.
   *
   * Why not the Stripe Customer Portal's plan switcher: our subscriptions carry two items (base +
   * a metered overage price on the same product), and the portal's generic switcher targets only
   * the licensed item — it would leave a customer on the new base with the OLD plan's overage rate.
   * So the swap is done here, atomically, over both items.
   */
  changePlan(opts: { subscriptionId: string; newBasePriceId: string; newOveragePriceId: string }): Promise<void>
  /**
   * Preview the money impact of a plan change WITHOUT applying it (Stripe invoice preview). Returns
   * the prorated credit (unused time on the current plan, ≤ 0), the prorated charge (remaining time
   * on the target plan, ≥ 0), their net, and the date it settles — so the confirm dialog shows real
   * numbers, not a vague promise. The new plan takes effect immediately; the net lands on the next
   * invoice at `nextInvoiceDate` (renewal), nothing is charged now.
   */
  previewChange(opts: { subscriptionId: string; newBasePriceId: string; newOveragePriceId: string }): Promise<PlanChangePreview>
  /**
   * Live billing details for the advanced page: the current period bounds, the upcoming invoice
   * total (base + any pending overage/proration), the default card, and the overage per-device-day
   * rate. One Stripe round-trip's worth of reads; absent pieces come back null.
   */
  billingDetails(opts: { subscriptionId: string; customerId: string; overagePriceId?: string | undefined }): Promise<BillingLiveDetails>
  /** Verify the webhook signature and parse the event. THROWS on an invalid signature. */
  constructEvent(rawBody: string, signature: string): StripeEvent
  /** The metered overage price id for a base plan (TSP), added as a 2nd checkout line item;
   *  undefined for a Direct plan. (The daily usage push itself lives in the worker.) */
  overageFor(basePriceId: string): string | undefined
  /** The entitlement plan a base price grants (both Direct + TSP), for the webhook to persist as
   *  the tenant's tier; undefined for an unmapped/unknown price (leaves the plan unchanged). */
  planFor(basePriceId: string): TenantPlan | undefined
}

export interface StripeConfig {
  secretKey: string
  webhookSecret: string
  /** Allowlist of subscribable Stripe BASE price ids (`price_…`). Two-track catalog per
   *  PRICING_STRATEGY.md §7 (Direct flat tiers + TSP base). */
  priceIds: string[]
  /** base price id → metered overage price id (TSP only) — added as a 2nd checkout line item. */
  overageMap: Record<string, string>
  /** base price id → entitlement plan (TenantPlan). Only valid plans land here (garbage dropped);
   *  the webhook persists this as the tenant's tier. */
  planMap: Record<string, TenantPlan>
  /**
   * Let Stripe Tax compute VAT on top of the listed price (`STRIPE_TAX_ENABLED`).
   *
   * OFF today, and correctly so: MB Dokigo is not VAT-registered yet, so charging the bare amount is
   * what the law wants. It becomes registered on crossing the revenue threshold, and that day must
   * not need a code deploy — hence a flag rather than a hard-coded `automatic_tax`.
   *
   * Every Price already carries `tax_behavior: exclusive`, set 2026-09-02 while the catalogue had no
   * subscribers. That field is a ONE-WAY transition (`unspecified` → `exclusive`, never back), so
   * doing it early is the difference between flipping a switch and rewriting a live catalogue.
   * Verified against Stripe: with tax off, `exclusive` and `unspecified` both charge exactly the
   * listed amount, so setting it changed nothing for a customer.
   */
  taxEnabled: boolean
}

/** Parse a `a:b,c:d` env pair-map (base price → overage price). */
function parsePairMap(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of (raw ?? '').split(',')) {
    const [k, v] = pair.split(':').map((s) => s.trim())
    if (k === undefined || k === '' || v === undefined || v === '') continue
    out[k] = v
  }
  return out
}

/** Parse `STRIPE_PLAN_MAP` (base price → plan), keeping ONLY entries whose value is a real
 *  TenantPlan — an unknown/garbage plan string is dropped so an invalid plan can never be written. */
function parsePlanMap(raw: string | undefined): Record<string, TenantPlan> {
  const out: Record<string, TenantPlan> = {}
  for (const [priceId, value] of Object.entries(parsePairMap(raw))) {
    const parsed = tenantPlanSchema.safeParse(value)
    if (parsed.success) out[priceId] = parsed.data
  }
  return out
}

/** Build config from env, or null when billing is not configured (no keys ⇒ routes 503).
 *  STRIPE_PRICES = allowlist; STRIPE_OVERAGE_MAP = base:overage,…; STRIPE_PLAN_MAP = base:plan,…
 *  (the worker owns STRIPE_INCLUDED). */
export function stripeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  const secretKey = env['STRIPE_SECRET_KEY']
  const webhookSecret = env['STRIPE_WEBHOOK_SECRET']
  const priceIds = (env['STRIPE_PRICES'] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  if (!secretKey || !webhookSecret || priceIds.length === 0) return null
  return {
    secretKey,
    webhookSecret,
    priceIds,
    overageMap: parsePairMap(env['STRIPE_OVERAGE_MAP']),
    planMap: parsePlanMap(env['STRIPE_PLAN_MAP']),
    // absent/'0'/'false' → off. Only an explicit truthy value turns VAT on, because the failure
    // direction matters: charging VAT we are not registered to collect is worse than not charging it.
    taxEnabled: ['1', 'true', 'yes'].includes((env['STRIPE_TAX_ENABLED'] ?? '').trim().toLowerCase()),
  }
}

/** A finite number, or null. */
function numOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Unix seconds → ISO instant, or null. */
function instantOf(sec: number | null): string | null {
  return sec !== null ? new Date(sec * 1000).toISOString() : null
}

/** The max item-level current_period_end (Stripe flexible billing puts the period on items). */
function periodEndSecondsOf(sub: Stripe.Subscription): number | null {
  let max = 0
  for (const it of sub.items.data) {
    const v = it.current_period_end
    if (typeof v === 'number' && v > max) max = v
  }
  return max > 0 ? max : null
}

/** Extract the card summary from an expanded PaymentMethod (or null for a string id / no card). */
function cardOf(pm: string | Stripe.PaymentMethod | null | undefined): { brand: string; last4: string; expMonth: number; expYear: number } | null {
  if (pm === null || pm === undefined || typeof pm === 'string') return null
  const c = pm.card
  if (c == null) return null
  return { brand: c.brand, last4: c.last4, expMonth: c.exp_month, expYear: c.exp_year }
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
          plan: cfg.planMap[p.id] ?? null,
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
    planFor: (basePriceId) => cfg.planMap[basePriceId],
    createCheckoutSession: async ({ customerId, tenantId, priceId, successUrl, cancelUrl, idempotencyKey }) => {
      // TSP plans carry a metered overage price as a 2nd line item (no quantity — usage-reported);
      // Direct plans have none. The base is always flat quantity 1.
      const overage = cfg.overageMap[priceId]
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: priceId, quantity: 1 }]
      if (overage !== undefined) lineItems.push({ price: overage })
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: customerId,
          line_items: lineItems,
          success_url: successUrl,
          cancel_url: cancelUrl,
          client_reference_id: tenantId,
          subscription_data: { metadata: { tenantId } },
          ...(cfg.taxEnabled
            ? {
                automatic_tax: { enabled: true },
                // EU B2B reverse charge only works if the buyer can hand over a VAT ID
                tax_id_collection: { enabled: true },
                // Stripe Tax needs an address to pick a jurisdiction; an EXISTING customer without
                // one makes the session fail outright, so let Checkout collect and save it
                customer_update: { address: 'auto', name: 'auto' },
              }
            : {}),
        },
        // Stripe dedupes identical creates under the same key (audit LOW double-subscribe guard)
        ...(idempotencyKey !== undefined ? [{ idempotencyKey }] : []),
      )
      if (!session.url) throw new Error('stripe checkout session returned no url')
      return session.url
    },
    createPortalSession: async ({ customerId, returnUrl }) => {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })
      return session.url
    },
    changePlan: async ({ subscriptionId, newBasePriceId, newOveragePriceId }) => {
      // read the current items so we UPDATE them in place (by item id) rather than adding a third
      // line — Stripe replaces an item's price when you pass its id + a new price
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      const baseItem = sub.items.data.find((i) => i.price.recurring?.usage_type === 'licensed')
      const overageItem = sub.items.data.find((i) => i.price.recurring?.usage_type === 'metered')
      if (baseItem === undefined) throw new Error('subscription has no licensed base item')
      const items: Stripe.SubscriptionUpdateParams.Item[] = [{ id: baseItem.id, price: newBasePriceId }]
      // a subscription created via our checkout always has the overage item; guard anyway so a
      // hand-made subscription without one changes the base rather than throwing
      if (overageItem !== undefined) items.push({ id: overageItem.id, price: newOveragePriceId })
      await stripe.subscriptions.update(subscriptionId, {
        items,
        // upgrade charges the prorated difference now; downgrade credits it against the next invoice
        proration_behavior: 'create_prorations',
        // the webhook (customer.subscription.updated) carries the new base price → the tenant's plan
        // and entitlements are persisted there, the same path a checkout uses
      })
    },
    previewChange: async ({ subscriptionId, newBasePriceId, newOveragePriceId }) => {
      const sub = await stripe.subscriptions.retrieve(subscriptionId)
      const baseItem = sub.items.data.find((i) => i.price.recurring?.usage_type === 'licensed')
      const overageItem = sub.items.data.find((i) => i.price.recurring?.usage_type === 'metered')
      if (baseItem === undefined) throw new Error('subscription has no licensed base item')
      const items: Stripe.InvoiceCreatePreviewParams.SubscriptionDetails.Item[] = [{ id: baseItem.id, price: newBasePriceId }]
      if (overageItem !== undefined) items.push({ id: overageItem.id, price: newOveragePriceId })
      // proration_date = now anchors THIS change's proration lines to a known period.start, so we can
      // isolate them from any proration already pending on the upcoming invoice.
      const prorationDate = Math.floor(Date.now() / 1000)
      const preview = await stripe.invoices.createPreview({
        subscription: subscriptionId,
        subscription_details: { items, proration_behavior: 'create_prorations', proration_date: prorationDate },
      })
      let credit = 0
      let charge = 0
      for (const line of preview.lines.data) {
        // THIS change's proration lines are exactly the ones whose period starts at our anchor: the
        // "unused time on <old>" credit and the "remaining time on <new>" charge. The next period's
        // regular charge starts at period_end, and pending proration from an earlier change starts at
        // its own (earlier) anchor — both excluded. Any €0 same-anchor segment line adds nothing.
        // (The API moved the boolean to line.parent.subscription_item_details.proration; the anchor
        // filter alone is sufficient and type-stable, so we key on period.start.)
        if (line.period?.start !== prorationDate) continue
        if (line.amount < 0) credit += line.amount
        else charge += line.amount
      }
      return {
        credit,
        charge,
        net: credit + charge,
        currency: preview.currency,
        nextInvoiceDate: instantOf(periodEndSecondsOf(sub)),
      }
    },
    billingDetails: async ({ subscriptionId, customerId, overagePriceId }) => {
      const [sub, overagePrice] = await Promise.all([
        stripe.subscriptions.retrieve(subscriptionId, { expand: ['default_payment_method'] }),
        overagePriceId !== undefined ? stripe.prices.retrieve(overagePriceId) : Promise.resolve(null),
      ])
      const item = sub.items.data[0]
      // the default card: the subscription's own, else the customer's invoice-settings default
      let pm = cardOf(sub.default_payment_method)
      if (pm === null) {
        const cust = await stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] })
        if (!('deleted' in cust && cust.deleted)) pm = cardOf(cust.invoice_settings?.default_payment_method)
      }
      let upcomingTotal: number | null = null
      let currency: string | null = overagePrice?.currency ?? null
      try {
        const preview = await stripe.invoices.createPreview({ subscription: subscriptionId })
        upcomingTotal = preview.total
        currency = preview.currency
      } catch {
        // a subscription with no forthcoming invoice (e.g. canceling) — leave the estimate null
      }
      const overageDecimal = overagePrice?.unit_amount_decimal
      return {
        periodStart: instantOf(numOf(item?.current_period_start)),
        periodEnd: instantOf(numOf(item?.current_period_end)),
        upcomingTotal,
        currency,
        paymentMethod: pm,
        overagePerDeviceDay: overageDecimal != null ? Number(overageDecimal) : null,
      }
    },
    constructEvent: (rawBody, signature) =>
      stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret) as unknown as StripeEvent,
  }
}
