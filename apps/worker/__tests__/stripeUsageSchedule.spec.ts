import { describe, expect, it } from 'vitest'

import { Queue } from 'bullmq'

import { STRIPE_USAGE_EVERY_MS, scheduleStripeUsage } from '../src/jobs/stripeUsageQueue.js'

/**
 * Changing a repeatable job's interval does NOT replace its schedule (audit review MED).
 *
 * BullMQ derives a repeatable's key from its options, `every` included, so a new interval mints a
 * NEW schedule and leaves the old one running forever — nothing in the codebase removed it. After
 * 24 h → 12 h both fire, and since `getNextMillis` is epoch-aligned every 24 h boundary is also a
 * 12 h one: two runs at the same millisecond, once a day. Across worker replicas those interleave,
 * read the same previously-reported value, compute different totals, submit two identifiers Stripe
 * cannot dedupe, and the customer is billed twice for overlapping usage.
 */
function fakeQueue(existing: { key: string; name: string; every?: string | null }[]) {
  const removed: string[] = []
  const added: unknown[] = []
  const queue = {
    getRepeatableJobs: () => Promise.resolve(existing),
    removeRepeatableByKey: (key: string) => { removed.push(key); return Promise.resolve(true) },
    add: (...args: unknown[]) => { added.push(args); return Promise.resolve({}) },
  } as unknown as Queue
  return { queue, removed, added }
}

describe('scheduleStripeUsage', () => {
  it('removes a schedule left behind by a PREVIOUS interval', async () => {
    const { queue, removed, added } = fakeQueue([
      { key: 'stripe-usage-daily:report::::86400000', name: 'report', every: '86400000' }, // the old 24 h
    ])
    await scheduleStripeUsage(queue)
    expect(removed).toEqual(['stripe-usage-daily:report::::86400000'])
    expect(added).toHaveLength(1) // …and the current one is still upserted
  })

  it('leaves the CURRENT schedule alone — an upsert must not churn it every boot', async () => {
    const { queue, removed } = fakeQueue([
      { key: `stripe-usage-daily:report::::${STRIPE_USAGE_EVERY_MS}`, name: 'report', every: String(STRIPE_USAGE_EVERY_MS) },
    ])
    await scheduleStripeUsage(queue)
    expect(removed).toEqual([])
  })

  it('never touches another job’s schedule on the same queue', async () => {
    const { queue, removed } = fakeQueue([{ key: 'other:thing::::3600000', name: 'thing', every: '3600000' }])
    await scheduleStripeUsage(queue)
    expect(removed).toEqual([])
  })
})
