import { describe, expect, it } from 'vitest'

import type { Db, LapsedTenant } from '@orbetra/db'

import { DEFAULT_GRACE_DAYS, graceDaysFromEnv, isActionable, runLapseSweep } from '../src/jobs/lapseSweepWorker.js'

/**
 * The lapsed-tenant sweep (audit MED #22).
 *
 * The finding is that a floored tenant — canceled subscription, or a self-serve trial that ran out —
 * keeps full tracking indefinitely, because `deviceLimit` is the only floored field and it is read
 * only when a device is CREATED. The sweep does not cut anyone off (that is a policy call, with a
 * warning e-mail and a grace period, not a background job's decision); it makes the set countable,
 * which is what nothing did before.
 */
const NOW = Date.UTC(2026, 7, 5, 12)
const daysAgo = (n: number): Date => new Date(NOW - n * 86_400_000)

const lapsed = (over: Partial<LapsedTenant> = {}): LapsedTenant => ({
  tenantId: 't1',
  name: 'Lapsed Co',
  plan: 'direct_10',
  subscriptionStatus: 'canceled',
  lapsedAt: daysAgo(30),
  reason: 'subscription_lapsed',
  activeDevices: 10,
  ...over,
})

describe('isActionable', () => {
  it('holds off during the grace window and fires once it is past', () => {
    expect(isActionable(lapsed({ lapsedAt: daysAgo(3) }), NOW, 14)).toBe(false)
    expect(isActionable(lapsed({ lapsedAt: daysAgo(13) }), NOW, 14)).toBe(false)
    expect(isActionable(lapsed({ lapsedAt: daysAgo(14) }), NOW, 14)).toBe(true)
    expect(isActionable(lapsed({ lapsedAt: daysAgo(400) }), NOW, 14)).toBe(true)
  })

  it('an UNKNOWN lapse date counts as actionable — treating it as recent would hide the oldest', () => {
    // rows written before lastBillingEventAt existed have no date; those are precisely the tenants
    // that have been getting the product free the longest
    expect(isActionable(lapsed({ lapsedAt: null }), NOW, 14)).toBe(true)
  })

  it('a zero grace window fires immediately, without treating "today" as the future', () => {
    expect(isActionable(lapsed({ lapsedAt: new Date(NOW) }), NOW, 0)).toBe(true)
  })
})

describe('graceDaysFromEnv', () => {
  it('defaults to 14 and clamps rather than accepting a negative or absurd window', () => {
    expect(graceDaysFromEnv({})).toBe(DEFAULT_GRACE_DAYS)
    expect(graceDaysFromEnv({ BILLING_GRACE_DAYS: 'soon' })).toBe(DEFAULT_GRACE_DAYS)
    expect(graceDaysFromEnv({ BILLING_GRACE_DAYS: '-5' })).toBe(0)
    expect(graceDaysFromEnv({ BILLING_GRACE_DAYS: '99999' })).toBe(365)
    expect(graceDaysFromEnv({ BILLING_GRACE_DAYS: '7' })).toBe(7)
  })
})

describe('runLapseSweep', () => {
  const fakeDb = (rows: LapsedTenant[]): Db => ({ tenants: { listLapsedTenants: () => Promise.resolve(rows) } }) as unknown as Db

  it('counts every lapsed tenant’s devices, but only the past-grace ones as actionable', async () => {
    // the DEVICE count deliberately spans the grace window too: the ingest and storage cost is
    // being incurred the whole time, whether or not anyone should act on it yet
    const r = await runLapseSweep(
      fakeDb([
        lapsed({ tenantId: 'old', lapsedAt: daysAgo(60), activeDevices: 10 }),
        lapsed({ tenantId: 'fresh', lapsedAt: daysAgo(2), activeDevices: 4 }),
        lapsed({ tenantId: 'trial', lapsedAt: daysAgo(90), reason: 'trial_expired', subscriptionStatus: 'trialing', activeDevices: 1 }),
      ]),
      NOW,
      14,
    )
    expect(r).toEqual({ tenants: 3, devices: 15, actionable: 2 })
  })

  it('a clean platform reports zeroes rather than nothing — the gauge must fall back', async () => {
    expect(await runLapseSweep(fakeDb([]), NOW, 14)).toEqual({ tenants: 0, devices: 0, actionable: 0 })
  })
})
