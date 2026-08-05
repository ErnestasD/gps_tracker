import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'

import { isBillableSubscription, LAPSED_SUBSCRIPTION_STATUSES } from '@orbetra/shared'

import { createTenantRepo } from '../src/repos/tenants.js'
import type { AuditRepo } from '../src/repos/audit.js'

const audit = { record: vi.fn() } as unknown as AuditRepo

/** Honours the `where` the repo passes, so a regression that DROPS a predicate actually fails. */
const repoOver = (rows: { id: string; subscriptionStatus: string | null; stripeCustomerId?: string | null }[]) => {
  const seen: { where?: Record<string, unknown> }[] = []
  const findMany = vi.fn((args: { where: Record<string, unknown> }) => {
    seen.push(args)
    const w = args.where
    return Promise.resolve(
      rows
        .map((r) => ({ ...r, stripeCustomerId: 'stripeCustomerId' in r ? r.stripeCustomerId! : `cus_${r.id}`, subscriptionPriceId: 'price_1', plan: 'tsp_grow' }))
        .filter((r) => (w['stripeCustomerId'] === undefined ? true : r.stripeCustomerId !== null))
        .filter((r) => (w['subscriptionStatus'] === undefined ? true : r.subscriptionStatus !== null)),
    )
  })
  return { repo: createTenantRepo({ tenant: { findMany } } as unknown as PrismaClient, audit), seen }
}

describe('overage metering follows entitlements (audit high)', () => {
  it('meters EVERY status that still grants entitlements — including past_due', async () => {
    // The two predicates used to be independent lists: entitlements deliberately exclude `past_due`
    // from the lapsed set (Stripe's dunning grace window) while the usage reporter only selected
    // ('active','trialing'). So for the whole dunning window a tenant kept white-label, sub-accounts,
    // API, webhooks, SMS and an uncapped device count while NOT ONE device-day was billed —
    // and the reporter only ever submits `now − 24 h` with no backfill, so those days are lost
    // permanently even after the card is fixed. ~€283 per incident at TSP Grow scale.
    const { repo, seen } = repoOver([
      { id: 'active', subscriptionStatus: 'active' },
      { id: 'trialing', subscriptionStatus: 'trialing' },
      { id: 'pastdue', subscriptionStatus: 'past_due' },
      { id: 'canceled', subscriptionStatus: 'canceled' },
      { id: 'unpaid', subscriptionStatus: 'unpaid' },
      { id: 'paused', subscriptionStatus: 'paused' },
      { id: 'admin', subscriptionStatus: null },
      { id: 'nocustomer', subscriptionStatus: 'active', stripeCustomerId: null },
    ])
    const rows = await repo.listActiveSubscribers()
    expect(rows.map((r) => r.tenantId).sort()).toEqual(['active', 'pastdue', 'trialing'])
    // `stripeCustomerId` is non-null-asserted downstream, so the predicate must actually be sent
    expect(seen[0]!.where).toMatchObject({ stripeCustomerId: { not: null } })
  })

  it('"entitled" and "metered" are the SAME set — asserted as literals, not re-derived', () => {
    // spelled out on purpose: `expect(f(s)).toBe(!LAPSED.has(s))` just re-implements the function
    // body and cannot fail. These are the statuses as a human reads Stripe's docs.
    for (const billable of ['active', 'trialing', 'past_due', 'incomplete']) {
      expect(isBillableSubscription(billable), billable).toBe(true)
    }
    for (const lapsed of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
      expect(isBillableSubscription(lapsed), lapsed).toBe(false)
      expect(LAPSED_SUBSCRIPTION_STATUSES.has(lapsed), lapsed).toBe(true) // and entitlements agree
    }
    expect(isBillableSubscription(null)).toBe(false) // admin-granted: nothing to bill
  })
})
