import { describe, expect, it } from 'vitest'

import type { Db } from '@orbetra/db'

import { overageDevices, reportDailyOverage, type StripeUsagePort } from '../src/billing/usageReporter.js'

/**
 * Stripe overage reporter (ADR-024 PR B2). Proves the money-critical rules: overage = devices beyond
 * the plan's included allowance (never negative); Direct plans (no included count) are skipped; and
 * only tenants with a positive overage are reported — with the excess DEVICE count (the per-device-day
 * price then turns summed daily values into device-days of overage).
 */
describe('overageDevices', () => {
  it('is the excess over included, never negative', () => {
    expect(overageDevices(205, 200)).toBe(5)
    expect(overageDevices(200, 200)).toBe(0)
    expect(overageDevices(10, 200)).toBe(0)
  })
})

// a fake port: 'price_tsp' includes 200 devices; 'price_direct' has no overage
const port = (reports: { customerId: string; value: number }[]): StripeUsagePort => ({
  includedFor: (p) => (p === 'price_tsp' ? 200 : undefined),
  reportUsage: ({ customerId, value }) => { reports.push({ customerId, value }); return Promise.resolve() },
})

// a fake Db exposing only what the reporter uses
function fakeDb(subs: { tenantId: string; stripeCustomerId: string; subscriptionPriceId: string | null }[], activeByTenant: Record<string, number>): Db {
  return {
    tenants: { listActiveSubscribers: () => Promise.resolve(subs) },
    usage: { tenantSummary: (scope: { tenantId: string }) => Promise.resolve([{ day: '2026-07-13', deviceDays: activeByTenant[scope.tenantId] ?? 0 }]) },
  } as unknown as Db
}

describe('reportDailyOverage', () => {
  it('reports only TSP tenants over their allowance, with the excess device count', async () => {
    const reports: { customerId: string; value: number }[] = []
    const db = fakeDb(
      [
        { tenantId: 't-over', stripeCustomerId: 'cus_over', subscriptionPriceId: 'price_tsp' }, // 205 → over by 5
        { tenantId: 't-under', stripeCustomerId: 'cus_under', subscriptionPriceId: 'price_tsp' }, // 150 → no overage
        { tenantId: 't-direct', stripeCustomerId: 'cus_direct', subscriptionPriceId: 'price_direct' }, // Direct → skip
        { tenantId: 't-noplan', stripeCustomerId: 'cus_noplan', subscriptionPriceId: null }, // unknown plan → skip
      ],
      { 't-over': 205, 't-under': 150, 't-direct': 999, 't-noplan': 999 },
    )
    const r = await reportDailyOverage({ db, stripe: port(reports) }, '2026-07-13', 1_800_000_000)
    expect(r).toMatchObject({ subscribers: 4, reported: 1, devicesOver: 5 })
    expect(reports).toEqual([{ customerId: 'cus_over', value: 5 }]) // ONLY the over-allowance TSP tenant
  })

  it('reports nothing when no tenant exceeds its allowance', async () => {
    const reports: { customerId: string; value: number }[] = []
    const db = fakeDb([{ tenantId: 't1', stripeCustomerId: 'cus_1', subscriptionPriceId: 'price_tsp' }], { t1: 200 })
    const r = await reportDailyOverage({ db, stripe: port(reports) }, '2026-07-13', 1_800_000_000)
    expect(r.reported).toBe(0)
    expect(reports).toHaveLength(0)
  })
})
