import { describe, expect, it } from 'vitest'

import { TSP_PLANS } from '../src/components/site/TspPricing.js'

/**
 * The pricing invariants, not the pricing.
 *
 * PRICING_STRATEGY.md §3 states one rule: **overage must sit above the effective base rate**.
 * Below it, a customer is better off under-provisioned than moving up a tier, and every device past
 * the allowance earns less than the ones inside it.
 *
 * It is worth a test because the rule was silently broken on ALL THREE tiers before 2026-09-02
 * (€0.60 < €0.745, €0.40 < €0.532, €0.35 < €0.3596) and nothing anywhere noticed — the numbers had
 * simply drifted apart as allowances were set by feel. A future edit that raises an allowance
 * without revisiting the overage re-breaks it in exactly the same silent way.
 */
describe('TSP plan economics (PRICING_STRATEGY.md §3)', () => {
  it.each(TSP_PLANS.map((p) => [p.name, p] as const))(
    '%s: overage stays above the effective base rate',
    (_name, p) => {
      const effective = p.base / p.included
      expect(p.overage).toBeGreaterThan(effective)
    },
  )

  it.each(TSP_PLANS.map((p) => [p.name, p] as const))(
    '%s: the €/device shown on the card matches base ÷ included',
    (_name, p) => {
      // the card prints `perDevice` beside the allowance; a stale figure there is a quoted price
      // that does not follow from the two numbers next to it
      expect(p.perDevice).toBeCloseTo(p.base / p.included, 2)
    },
  )

  it('every tier is cheaper per device than the one below it', () => {
    const rates = TSP_PLANS.map((p) => p.base / p.included)
    const descending = rates.slice(1).every((r, i) => r < rates[i])
    expect({ rates, descending }).toEqual({ rates, descending: true })
  })

  it('annual is exactly ten months of the monthly price (2 months free)', () => {
    for (const p of TSP_PLANS) expect(p.baseYearly).toBe(p.base * 10)
  })
})
