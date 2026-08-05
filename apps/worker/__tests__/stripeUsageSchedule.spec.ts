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
      // a REAL bullmq 5 repeat key is an md5 of (name:jobId:endDate:tz:every), not a readable concat
      { key: '544d2da08cde02c924fdaaa646bc6dad', name: 'report', every: '86400000' }, // the old 24 h
    ])
    await scheduleStripeUsage(queue)
    expect(removed).toEqual(['544d2da08cde02c924fdaaa646bc6dad'])
    expect(added).toHaveLength(1) // …and the current one is still upserted
  })

  it('leaves the CURRENT schedule alone — an upsert must not churn it every boot', async () => {
    const { queue, removed } = fakeQueue([
      { key: 'b7a1f0c2d3e4f5061728394a5b6c7d8e', name: 'report', every: String(STRIPE_USAGE_EVERY_MS) },
    ])
    await scheduleStripeUsage(queue)
    expect(removed).toEqual([])
  })

  it('a NUMERIC `every` compares equal too — the newer scheduler API returns one', () => {
    // `getRepeatableJobs` round-trips through Redis and yields a string; `getJobSchedulers` yields a
    // number. Comparing a number to a string literal is true every boot, which would churn the LIVE
    // schedule on every restart — a no-schedule window on the billing job, forever.
    const { queue, removed } = fakeQueue([
      { key: 'c9d8e7f6a5b4c3d2e1f00918273645ab', name: 'report', every: STRIPE_USAGE_EVERY_MS as unknown as string },
    ])
    return scheduleStripeUsage(queue).then(() => expect(removed).toEqual([]))
  })

  it('never touches another job’s schedule on the same queue', async () => {
    const { queue, removed } = fakeQueue([{ key: 'other:thing::::3600000', name: 'thing', every: '3600000' }])
    await scheduleStripeUsage(queue)
    expect(removed).toEqual([])
  })
})
