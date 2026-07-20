import { describe, expect, it } from 'vitest'

import { createStripeGateway, stripeConfigFromEnv } from '../src/billing/stripe.js'

/**
 * Stripe gateway unit tests (no SDK network — the Stripe constructor is lazy, planFor is pure).
 * Focus (WP4): STRIPE_PLAN_MAP parsing + planFor — a known base price → its TenantPlan, and an
 * unknown/garbage/unmapped price → undefined so an invalid plan can NEVER be written by the webhook.
 */
const BASE_ENV = {
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_dummy',
  STRIPE_PRICES: 'price_direct10,price_tspstart',
} as const

describe('stripeConfigFromEnv + planFor (STRIPE_PLAN_MAP)', () => {
  it('parses base:plan pairs and drops entries whose value is not a real TenantPlan', () => {
    const cfg = stripeConfigFromEnv({
      ...BASE_ENV,
      // one valid direct, one valid tsp, one GARBAGE plan string that must be dropped
      STRIPE_PLAN_MAP: 'price_direct10:direct_10,price_tspstart:tsp_start,price_bad:not_a_plan',
    })
    expect(cfg).not.toBeNull()
    expect(cfg?.planMap).toEqual({ price_direct10: 'direct_10', price_tspstart: 'tsp_start' })
  })

  it('planFor maps a known base price to its plan and returns undefined for unknown/garbage/unmapped', () => {
    const cfg = stripeConfigFromEnv({
      ...BASE_ENV,
      STRIPE_PLAN_MAP: 'price_direct10:direct_10,price_tspstart:tsp_start,price_garbage:xxxxx',
    })
    const gw = createStripeGateway(cfg!)
    expect(gw.planFor('price_direct10')).toBe('direct_10') // known → plan
    expect(gw.planFor('price_tspstart')).toBe('tsp_start')
    expect(gw.planFor('price_garbage')).toBeUndefined() // value wasn't a TenantPlan → dropped
    expect(gw.planFor('price_unknown')).toBeUndefined() // not in the map at all
  })

  it('an absent STRIPE_PLAN_MAP yields an empty map (planFor always undefined)', () => {
    const cfg = stripeConfigFromEnv(BASE_ENV)
    expect(cfg?.planMap).toEqual({})
    expect(createStripeGateway(cfg!).planFor('price_direct10')).toBeUndefined()
  })
})
