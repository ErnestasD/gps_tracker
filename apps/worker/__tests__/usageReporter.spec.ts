import { describe, expect, it } from 'vitest'

import type { Db } from '@orbetra/db'

import { billableDays, meterTimestampS, overageDevices, reportDailyOverage, type StripeUsagePort } from '../src/billing/usageReporter.js'
import { backfillDaysFromEnv } from '../src/jobs/stripeUsageWorker.js'

/**
 * Stripe overage reporter (ADR-024 PR B2, audit MED #21 + #23).
 *
 * The money-critical rules: overage = devices beyond the plan's included allowance (never negative);
 * Direct plans (no included count) are skipped; only a positive delta is reported. The #21 half is
 * that reporting is no longer a single shot at yesterday — each run re-walks a trailing window and
 * submits the difference against what Stripe has already been told, so usage that lands late (a
 * buffered device flushing after midnight, a run that failed, a worker that was down) is still
 * billed instead of lost. The #23 half is that a TSP price missing from STRIPE_INCLUDED is a
 * misconfiguration that must be COUNTED, not silently treated like a Direct plan.
 */
describe('overageDevices', () => {
  it('is the excess over included, never negative', () => {
    expect(overageDevices(205, 200)).toBe(5)
    expect(overageDevices(200, 200)).toBe(0)
    expect(overageDevices(10, 200)).toBe(0)
  })
})

describe('billableDays', () => {
  const NOON_JUL_13 = Date.UTC(2026, 6, 13, 12)

  it('is the complete days ending YESTERDAY, oldest first — never today', () => {
    expect(billableDays(NOON_JUL_13, 3)).toEqual(['2026-07-10', '2026-07-11', '2026-07-12'])
  })

  it('never bills today even at 23:59 — the day is not over, so its usage rows are not final', () => {
    expect(billableDays(Date.UTC(2026, 6, 13, 23, 59, 59), 1)).toEqual(['2026-07-12'])
  })

  it('crosses a month boundary by real date arithmetic, not by subtracting from the day number', () => {
    expect(billableDays(Date.UTC(2026, 7, 2, 3), 3)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01'])
  })

  it('a nonsense window still bills yesterday rather than nothing', () => {
    expect(billableDays(NOON_JUL_13, 0)).toEqual(['2026-07-12'])
  })
})

describe('meterTimestampS', () => {
  it('stamps NOON of the billed day, so a backdated event lands in that day’s billing period', () => {
    expect(meterTimestampS('2026-07-12')).toBe(Math.floor(Date.UTC(2026, 6, 12, 12) / 1000))
  })
})

describe('backfillDaysFromEnv', () => {
  it('defaults to 3 and clamps — 0 would restore the single-shot bug, 90 would be rejected by Stripe', () => {
    expect(backfillDaysFromEnv({})).toBe(3)
    expect(backfillDaysFromEnv({ STRIPE_BACKFILL_DAYS: 'nonsense' })).toBe(3)
    expect(backfillDaysFromEnv({ STRIPE_BACKFILL_DAYS: '0' })).toBe(1)
    expect(backfillDaysFromEnv({ STRIPE_BACKFILL_DAYS: '90' })).toBe(14)
    expect(backfillDaysFromEnv({ STRIPE_BACKFILL_DAYS: '7' })).toBe(7)
  })
})

interface Sent { customerId: string; value: number; identifier: string; timestampS: number }

/** a fake port: 'price_tsp' includes 200 devices; anything else has no included count */
const port = (sent: Sent[]): StripeUsagePort => ({
  includedFor: (p) => (p === 'price_tsp' ? 200 : undefined),
  reportUsage: (o) => { sent.push({ customerId: o.customerId, value: o.value, identifier: o.identifier, timestampS: o.timestampS }); return Promise.resolve() },
})

type Sub = { tenantId: string; stripeCustomerId: string; subscriptionPriceId: string | null; plan: string }

/**
 * A fake Db exposing only what the reporter uses, with a REAL report log: `recordOverageReport`
 * writes into the same map `reportedOverage` reads, so the delta arithmetic is exercised end to end
 * across successive runs rather than mocked away.
 */
function fakeDb(subs: Sub[], usage: Record<string, Record<string, number>>, log: Map<string, number> = new Map()) {
  const db = {
    tenants: { listActiveSubscribers: () => Promise.resolve(subs) },
    usage: {
      tenantSummary: (scope: { tenantId: string }, opts: { from: string; to: string }) =>
        Promise.resolve(
          Object.entries(usage[scope.tenantId] ?? {})
            .filter(([day]) => day >= opts.from && day <= opts.to)
            .map(([day, deviceDays]) => ({ day, deviceDays })),
        ),
      reportedOverage: (tenantId: string, opts: { from: string; to: string }) => {
        const out = new Map<string, number>()
        for (const [k, v] of log) {
          const [t, day] = k.split('|') as [string, string]
          if (t === tenantId && day >= opts.from && day <= opts.to) out.set(day, v)
        }
        return Promise.resolve(out)
      },
      recordOverageReport: (tenantId: string, day: string, reported: number) => {
        log.set(`${tenantId}|${day}`, reported)
        return Promise.resolve()
      },
    },
  } as unknown as Db
  return { db, log }
}

const DAYS = ['2026-07-11', '2026-07-12']
const tsp = (tenantId: string, cus: string): Sub => ({ tenantId, stripeCustomerId: cus, subscriptionPriceId: 'price_tsp', plan: 'tsp_grow' })

describe('reportDailyOverage', () => {
  it('reports only TSP tenants over their allowance, per day, with the excess device count', async () => {
    const sent: Sent[] = []
    const { db } = fakeDb(
      [
        tsp('t-over', 'cus_over'),
        tsp('t-under', 'cus_under'),
        { tenantId: 't-direct', stripeCustomerId: 'cus_direct', subscriptionPriceId: 'price_direct', plan: 'direct_10' },
        { tenantId: 't-noplan', stripeCustomerId: 'cus_noplan', subscriptionPriceId: null, plan: 'direct_10' },
      ],
      {
        't-over': { '2026-07-11': 205, '2026-07-12': 203 },
        't-under': { '2026-07-11': 150, '2026-07-12': 150 },
        't-direct': { '2026-07-11': 999 },
        't-noplan': { '2026-07-11': 999 },
      },
    )
    const r = await reportDailyOverage({ db, stripe: port(sent) }, DAYS)
    expect(r).toMatchObject({ subscribers: 4, reported: 2, devicesOver: 8, backfilled: 0, unmappedPrices: 0 })
    expect(sent).toEqual([
      { customerId: 'cus_over', value: 5, identifier: 'overage:2026-07-11:cus_over:0', timestampS: meterTimestampS('2026-07-11') },
      { customerId: 'cus_over', value: 3, identifier: 'overage:2026-07-12:cus_over:0', timestampS: meterTimestampS('2026-07-12') },
    ])
  })

  it('a SECOND run over the same days submits nothing — the report log, not luck, is what stops it', async () => {
    // this is the whole point of the trailing window: it may only ever bill the difference
    const sent: Sent[] = []
    const { db } = fakeDb([tsp('t1', 'cus_1')], { t1: { '2026-07-11': 205, '2026-07-12': 205 } })
    await reportDailyOverage({ db, stripe: port(sent) }, DAYS)
    expect(sent).toHaveLength(2)
    const second = await reportDailyOverage({ db, stripe: port(sent) }, DAYS)
    expect(sent).toHaveLength(2)
    expect(second).toMatchObject({ reported: 0, devicesOver: 0 })
  })

  it('LATE usage for a closed day is billed as a delta — the failure that used to lose it for good', async () => {
    // a device flushes its offline buffer at 00:30 and usage_daily grows for a day already reported
    const sent: Sent[] = []
    const usage = { t1: { '2026-07-11': 205 } as Record<string, number> }
    const { db } = fakeDb([tsp('t1', 'cus_1')], usage)
    await reportDailyOverage({ db, stripe: port(sent) }, DAYS)
    expect(sent.map((s) => s.value)).toEqual([5])

    usage.t1['2026-07-11'] = 209 // four more device-days landed after the fact
    const r = await reportDailyOverage({ db, stripe: port(sent) }, DAYS)
    expect(sent.map((s) => s.value)).toEqual([5, 4]) // +4, NOT 9 — the meter is additive
    expect(r).toMatchObject({ reported: 1, devicesOver: 4, backfilled: 1 })
    // the identifier carries the PREVIOUS cumulative value, so it differs from the first submission
    // (a re-fire of the SAME delta reuses it and Stripe dedupes)
    expect(sent[1]?.identifier).toBe('overage:2026-07-11:cus_1:5')
  })

  it('a MISSED run is recovered by the next one — the day is still inside the window', async () => {
    const sent: Sent[] = []
    const { db } = fakeDb([tsp('t1', 'cus_1')], { t1: { '2026-07-10': 210, '2026-07-11': 205, '2026-07-12': 202 } })
    // yesterday's run never happened; today's covers three days
    const r = await reportDailyOverage({ db, stripe: port(sent) }, ['2026-07-10', '2026-07-11', '2026-07-12'])
    expect(sent.map((s) => s.value)).toEqual([10, 5, 2])
    expect(r.devicesOver).toBe(17)
  })

  it('a RETROACTIVE DECREASE never sends a negative event, and does not re-bill on the next increase', async () => {
    // meter events cannot go down; the log keeps the high-water mark so the next real increase is
    // measured from it rather than billed twice
    const sent: Sent[] = []
    const usage = { t1: { '2026-07-11': 210 } as Record<string, number> }
    const { db } = fakeDb([tsp('t1', 'cus_1')], usage)
    await reportDailyOverage({ db, stripe: port(sent) }, DAYS) // +10
    usage.t1['2026-07-11'] = 204
    await reportDailyOverage({ db, stripe: port(sent) }, DAYS) // −6 → nothing
    expect(sent.map((s) => s.value)).toEqual([10])
    usage.t1['2026-07-11'] = 212
    await reportDailyOverage({ db, stripe: port(sent) }, DAYS) // 12 − 10 = +2, not +8
    expect(sent.map((s) => s.value)).toEqual([10, 2])
  })

  it('a day is NOT recorded as reported when Stripe rejects it — the retry must still bill it', async () => {
    const sent: Sent[] = []
    let fail = true
    const flaky: StripeUsagePort = {
      includedFor: (p) => (p === 'price_tsp' ? 200 : undefined),
      reportUsage: (o) => {
        if (fail) return Promise.reject(new Error('stripe 500'))
        sent.push({ customerId: o.customerId, value: o.value, identifier: o.identifier, timestampS: o.timestampS })
        return Promise.resolve()
      },
    }
    const { db, log } = fakeDb([tsp('t1', 'cus_1')], { t1: { '2026-07-11': 205 } })
    await expect(reportDailyOverage({ db, stripe: flaky }, DAYS)).rejects.toThrow(/1\/1 tenant/)
    expect(log.size).toBe(0) // nothing recorded → nothing lost
    fail = false
    await reportDailyOverage({ db, stripe: flaky }, DAYS)
    expect(sent.map((s) => s.value)).toEqual([5])
  })

  it('one tenant failure does NOT skip the others, and rethrows so BullMQ retries', async () => {
    const sent: Sent[] = []
    const failing: StripeUsagePort = {
      includedFor: (p) => (p === 'price_tsp' ? 200 : undefined),
      reportUsage: (o) => {
        if (o.customerId === 'cus_bad') return Promise.reject(new Error('stripe 500'))
        sent.push({ customerId: o.customerId, value: o.value, identifier: o.identifier, timestampS: o.timestampS })
        return Promise.resolve()
      },
    }
    const { db } = fakeDb([tsp('t-bad', 'cus_bad'), tsp('t-good', 'cus_good')], {
      't-bad': { '2026-07-11': 205 },
      't-good': { '2026-07-11': 210 },
    })
    await expect(reportDailyOverage({ db, stripe: failing }, DAYS)).rejects.toThrow(/1\/2 tenant/)
    expect(sent).toEqual([{ customerId: 'cus_good', value: 10, identifier: 'overage:2026-07-11:cus_good:0', timestampS: meterTimestampS('2026-07-11') }])
  })

  it('a TSP price missing from STRIPE_INCLUDED is COUNTED and surfaced — not silently unbilled', async () => {
    // the #23 failure: adding a plan in Stripe and forgetting the env entry looked identical to a
    // Direct plan, so every device on it billed as included, forever, with nothing to see
    const sent: Sent[] = []
    const seen: { tenantId: string; priceId: string; plan: string }[] = []
    const { db } = fakeDb(
      [
        { tenantId: 't-new', stripeCustomerId: 'cus_new', subscriptionPriceId: 'price_tsp_scale_2027', plan: 'tsp_scale' },
        { tenantId: 't-direct', stripeCustomerId: 'cus_direct', subscriptionPriceId: 'price_direct', plan: 'direct_25' },
      ],
      { 't-new': { '2026-07-11': 900 }, 't-direct': { '2026-07-11': 900 } },
    )
    const r = await reportDailyOverage({ db, stripe: port(sent), onUnmappedPrice: (i) => seen.push(i) }, DAYS)
    expect(r.unmappedPrices).toBe(1) // ONLY the TSP one — a Direct plan having no included count is correct
    expect(seen).toEqual([{ tenantId: 't-new', priceId: 'price_tsp_scale_2027', plan: 'tsp_scale' }])
    expect(sent).toHaveLength(0) // still cannot invent an allowance, but now it is loud
  })

  it('reports nothing when no tenant exceeds its allowance', async () => {
    const sent: Sent[] = []
    const { db } = fakeDb([tsp('t1', 'cus_1')], { t1: { '2026-07-11': 200, '2026-07-12': 199 } })
    const r = await reportDailyOverage({ db, stripe: port(sent) }, DAYS)
    expect(r.reported).toBe(0)
    expect(sent).toHaveLength(0)
  })
})
