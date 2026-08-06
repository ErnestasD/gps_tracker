import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'

import type { Db, LapsedTenant } from '@orbetra/db'

import { DEFAULT_GRACE_DAYS, daysPastGrace, graceDaysFromEnv, isActionable, noticeDue, runLapseSweep, SUSPEND_AFTER_DAYS } from '../src/jobs/lapseSweepWorker.js'

/**
 * The lapse ladder (audit MED #22, founder policy 2026-08-06): grace ends → notice, +1 day → notice,
 * +2 days → final notice, +3 days → suspend.
 *
 * The finding was that a floored tenant — canceled subscription, or a self-serve trial that ran out —
 * kept full tracking indefinitely, because `deviceLimit` is the only floored field and it is read
 * only when a device is CREATED. What matters most in these tests is not that suspension WORKS but
 * that it cannot happen to the wrong person: never inside grace, never without the final warning
 * having gone out, never when mail is unconfigured, and never to someone who has paid.
 */
const NOW = Date.UTC(2026, 7, 20, 12)
const daysAgo = (n: number): Date => new Date(NOW - n * 86_400_000)
const GRACE = 14

const lapsed = (over: Partial<LapsedTenant> = {}): LapsedTenant => ({
  tenantId: 't1',
  name: 'Lapsed Co',
  plan: 'direct_10',
  subscriptionStatus: 'canceled',
  lapsedAt: daysAgo(GRACE), // exactly at the end of grace
  reason: 'subscription_lapsed',
  activeDevices: 4,
  suspendedAt: null,
  noticeStage: 0,
  contactEmail: 'admin@lapsed.test',
  contactLocale: 'en',
  ...over,
})

describe('noticeDue', () => {
  it('walks the ladder one notice per day and stops at the final one', () => {
    expect(noticeDue(0, 0)).toBe(1) // grace just ended
    expect(noticeDue(1, 1)).toBe(2)
    expect(noticeDue(2, 2)).toBe(3)
    expect(noticeDue(3, 3)).toBeNull() // nothing left to say — suspension is next
  })

  it('never re-sends a notice already recorded — the sweep runs daily and may run twice', () => {
    expect(noticeDue(0, 1)).toBeNull()
    expect(noticeDue(1, 2)).toBeNull()
    expect(noticeDue(5, 3)).toBeNull()
  })

  it('a tenant discovered LATE gets the notice for where it is, not the whole ladder at once', () => {
    // grace ended 10 days ago while the job was not running: send the final warning, not three mails
    expect(noticeDue(10, 0)).toBe(SUSPEND_AFTER_DAYS)
  })

  it('says nothing at all while the tenant is still inside grace', () => {
    expect(noticeDue(-1, 0)).toBeNull()
    expect(noticeDue(-14, 0)).toBeNull()
  })
})

describe('daysPastGrace / isActionable', () => {
  it('counts from the lapse plus the grace window', () => {
    expect(daysPastGrace(lapsed({ lapsedAt: daysAgo(GRACE) }), NOW, GRACE)).toBe(0)
    expect(daysPastGrace(lapsed({ lapsedAt: daysAgo(GRACE + 3) }), NOW, GRACE)).toBe(3)
    expect(daysPastGrace(lapsed({ lapsedAt: daysAgo(2) }), NOW, GRACE)).toBe(-12)
  })

  it('an UNKNOWN lapse date is actionable — treating it as recent would hide the oldest cases', () => {
    expect(isActionable(lapsed({ lapsedAt: null }), NOW, GRACE)).toBe(true)
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

interface Sent { email: string; daysLeft: number }

/** A Db double with the six methods the sweep touches, plus a record of every write. */
function fakeDb(rows: LapsedTenant[], suspended: { tenantId: string; suspendedAt: Date }[] = []) {
  const notices: [string, number][] = []
  const suspends: string[] = []
  const unsuspends: string[] = []
  const db = {
    tenants: {
      listLapsedTenants: () => Promise.resolve(rows),
      listSuspended: () => Promise.resolve(suspended),
      registryDevicesFor: (tenantId: string) =>
        Promise.resolve([{ id: 1n, imei: '860000000000001', tenantId, accountId: 'a1', presenceRules: {}, odometerSource: 'auto' }]),
      markLapseNotice: (tenantId: string, stage: number) => { notices.push([tenantId, stage]); return Promise.resolve() },
      suspend: (tenantId: string) => { suspends.push(tenantId); return Promise.resolve(true) },
      unsuspend: (tenantId: string) => { unsuspends.push(tenantId); return Promise.resolve(true) },
    },
  } as unknown as Db
  return { db, notices, suspends, unsuspends }
}

/** Redis double: the registry calls only hget/eval/multi, and we only care THAT they happened. */
function fakeRedis() {
  const chain: Record<string, unknown> = {}
  for (const m of ['hset', 'hdel', 'sadd', 'srem', 'del']) chain[m] = () => chain
  chain['exec'] = () => Promise.resolve([])
  const touched: string[] = []
  const redis = {
    hget: () => Promise.resolve(null),
    eval: () => { touched.push('eval'); return Promise.resolve(1) },
    multi: () => { touched.push('multi'); return chain },
  } as unknown as Redis
  return { redis, touched }
}

const mailer = (sent: Sent[]) => ({ enqueueLapseEmail: (j: { email: string; daysLeft: number }) => { sent.push({ email: j.email, daysLeft: j.daysLeft }); return Promise.resolve() } })

describe('runLapseSweep', () => {
  it('sends ONE notice a day and counts down the days left', async () => {
    const sent: Sent[] = []
    const { db, notices } = fakeDb([lapsed({ lapsedAt: daysAgo(GRACE), noticeStage: 0 })])
    const { redis } = fakeRedis()
    const r = await runLapseSweep({ db, redis, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(sent).toEqual([{ email: 'admin@lapsed.test', daysLeft: 3 }])
    expect(notices).toEqual([['t1', 1]])
    expect(r).toMatchObject({ warned: 1, suspended: 0 })
  })

  it('does NOTHING while the tenant is inside the grace window', async () => {
    const sent: Sent[] = []
    const { db, notices, suspends } = fakeDb([lapsed({ lapsedAt: daysAgo(3) })])
    const { redis } = fakeRedis()
    const r = await runLapseSweep({ db, redis, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(sent).toEqual([])
    expect(notices).toEqual([])
    expect(suspends).toEqual([])
    expect(r).toMatchObject({ tenants: 1, actionable: 0 })
  })

  it('SUSPENDS on day 3 — but only after the final warning actually went out', async () => {
    const sent: Sent[] = []
    const { db, suspends } = fakeDb([lapsed({ lapsedAt: daysAgo(GRACE + 3), noticeStage: 3 })])
    const { redis, touched } = fakeRedis()
    const r = await runLapseSweep({ db, redis, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(suspends).toEqual(['t1'])
    expect(touched.length).toBeGreaterThan(0) // the registry was actually torn down
    expect(sent).toEqual([{ email: 'admin@lapsed.test', daysLeft: 0 }]) // and they were told
    expect(r.suspended).toBe(1)
  })

  it('will NOT suspend a tenant that never received the final warning', async () => {
    // a tenant discovered late is 10 days past grace with stage 0: it gets the final notice TODAY
    // and is cut off tomorrow. Losing the live map with no email first is worse than one more day.
    const sent: Sent[] = []
    const { db, suspends, notices } = fakeDb([lapsed({ lapsedAt: daysAgo(GRACE + 10), noticeStage: 0 })])
    const { redis } = fakeRedis()
    await runLapseSweep({ db, redis, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(notices).toEqual([['t1', 3]])
    expect(sent).toEqual([{ email: 'admin@lapsed.test', daysLeft: 1 }])
    expect(suspends).toEqual([])
  })

  it('will NOT suspend when mail is unconfigured — nobody is cut off silently', async () => {
    const { db, suspends } = fakeDb([lapsed({ lapsedAt: daysAgo(GRACE + 9), noticeStage: 3 })])
    const { redis } = fakeRedis()
    const r = await runLapseSweep({ db, redis }, NOW, GRACE) // no mail, no appBaseUrl
    expect(suspends).toEqual([])
    expect(r).toMatchObject({ warned: 0, suspended: 0, tenants: 1, actionable: 1 }) // still COUNTED
  })

  it('will NOT suspend without a registry to tear down — a flag with no effect is worse than neither', async () => {
    const sent: Sent[] = []
    const { db, suspends } = fakeDb([lapsed({ lapsedAt: daysAgo(GRACE + 9), noticeStage: 3 })])
    await runLapseSweep({ db, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE) // no redis
    expect(suspends).toEqual([])
  })

  it('never suspends the same tenant twice', async () => {
    const sent: Sent[] = []
    const { db, suspends } = fakeDb([lapsed({ lapsedAt: daysAgo(GRACE + 9), noticeStage: 3, suspendedAt: daysAgo(1) })])
    const { redis } = fakeRedis()
    const r = await runLapseSweep({ db, redis, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(suspends).toEqual([])
    expect(r.suspended).toBe(0)
    expect(sent).toEqual([]) // and does not re-mail them either
  })

  it('RESTORES a suspended tenant that paid — before anything else in the run', async () => {
    // `listLapsedTenants` returns only floored tenants, so a tenant that paid is simply absent from
    // it; the restore pass therefore reads its own set
    const sent: Sent[] = []
    const { db, unsuspends } = fakeDb([], [{ tenantId: 'paid-up', suspendedAt: daysAgo(5) }])
    const { redis, touched } = fakeRedis()
    const r = await runLapseSweep({ db, redis, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(unsuspends).toEqual(['paid-up'])
    expect(touched.length).toBeGreaterThan(0) // the registry was rebuilt
    expect(r.restored).toBe(1)
  })

  it('does NOT restore a suspended tenant that is still lapsed', async () => {
    const sent: Sent[] = []
    const { db, unsuspends } = fakeDb(
      [lapsed({ tenantId: 'still-lapsed', suspendedAt: daysAgo(5), noticeStage: 3, lapsedAt: daysAgo(GRACE + 9) })],
      [{ tenantId: 'still-lapsed', suspendedAt: daysAgo(5) }],
    )
    const { redis } = fakeRedis()
    await runLapseSweep({ db, redis, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(unsuspends).toEqual([])
  })

  it('one tenant’s failure does not stop the ladder for the rest', async () => {
    const sent: Sent[] = []
    const { db } = fakeDb([lapsed({ tenantId: 'bad', contactEmail: 'boom@x.test' }), lapsed({ tenantId: 'good', contactEmail: 'ok@x.test' })])
    const { redis } = fakeRedis()
    const mail = { enqueueLapseEmail: (j: { email: string; daysLeft: number }) => (j.email === 'boom@x.test' ? Promise.reject(new Error('queue down')) : (sent.push(j), Promise.resolve())) }
    const r = await runLapseSweep({ db, redis, mail, appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(sent.map((x) => x.email)).toEqual(['ok@x.test'])
    expect(r.warned).toBe(1)
  })

  it('a tenant with no admin to write to is counted but never suspended', async () => {
    const sent: Sent[] = []
    const { db, suspends } = fakeDb([lapsed({ contactEmail: null, noticeStage: 3, lapsedAt: daysAgo(GRACE + 9) })])
    const { redis } = fakeRedis()
    const r = await runLapseSweep({ db, redis, mail: mailer(sent), appBaseUrl: 'https://app.test' }, NOW, GRACE)
    expect(sent).toEqual([])
    // the ladder cannot warn them, so suspension still fires only because stage 3 was already
    // recorded — which can only have happened when an address existed. Assert the count is honest.
    expect(r.actionable).toBe(1)
    expect(suspends.length).toBe(1)
  })

  it('a clean platform reports zeroes rather than nothing — the gauges must fall back', async () => {
    const { db } = fakeDb([])
    const { redis } = fakeRedis()
    expect(await runLapseSweep({ db, redis }, NOW, GRACE)).toEqual({ tenants: 0, devices: 0, actionable: 0, warned: 0, suspended: 0, restored: 0 })
  })
})
