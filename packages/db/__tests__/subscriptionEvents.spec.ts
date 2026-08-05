import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, subscriptionEventRank, type Db, type SubscriptionUpdate } from '../src/index.js'

/**
 * The Stripe subscription webhook's ordering guard (ADR-024, audit MED #25).
 *
 * Run against a REAL Postgres because the guard IS the `updateMany` WHERE: a fake prisma would
 * assert the shape of the predicate I wrote rather than what the database does with it.
 *
 * The finding: `event.created` is Unix SECONDS, and Stripe emits several events for one state change
 * within the same second — a cancel is `customer.subscription.updated` immediately followed by
 * `.deleted`. Under a strict `lastBillingEventAt < eventAt` guard the second one compared equal and
 * was dropped as if it were a redelivery, leaving the tenant on the intermediate state: still
 * `active`, still entitled, still unbilled, until some unrelated later event happened to move it.
 */
const IMAGE = 'timescale/timescaledb-ha:pg16'
const PKG_DIR = resolve(import.meta.dirname, '..')
const actor = { userId: '00000000-0000-0000-0000-0000000000aa' }

let container: StartedTestContainer
let db: Db
let url: string

/** raw SQL for the fixtures the repos do not own (device_profiles has no repo). */
async function q<T extends pg.QueryResultRow>(sql: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return (await c.query<T>(sql)).rows
  } finally {
    await c.end()
  }
}

/** One second in the day of the events under test — every case here shares it deliberately. */
const T = new Date('2026-08-05T10:00:00.000Z')
const LATER = new Date('2026-08-05T10:00:01.000Z')
const EARLIER = new Date('2026-08-05T09:59:59.000Z')

const update = (status: string, subId: string | null = 'sub_A') => ({
  stripeSubscriptionId: subId,
  subscriptionStatus: status,
  subscriptionPriceId: 'price_tsp_grow',
  currentPeriodEnd: new Date('2026-09-05T10:00:00.000Z'),
})

/** A fresh tenant with a Stripe customer id, so each case is independent. */
async function tenantWithCustomer(name: string, customerId: string): Promise<string> {
  const t = await db.tenants.create(actor, { name })
  await db.tenants.setStripeCustomer(t.id, customerId)
  return t.id
}

const CREATED = 'customer.subscription.created'
const UPDATED = 'customer.subscription.updated'
const DELETED = 'customer.subscription.deleted'

/** positional shorthand — the cases here differ only in (customer, second, id, type) */
const apply = (stripeCustomerId: string, at: Date, id: string, type: string, data: SubscriptionUpdate) =>
  db.tenants.applySubscriptionEvent({ stripeCustomerId, at, id, type }, data)

const statusOf = async (id: string): Promise<string | null> => (await db.tenants.getBilling(id))?.subscriptionStatus ?? null

beforeAll(async () => {
  container = await new GenericContainer(IMAGE)
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(240_000)
    .start()
  url = `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: PKG_DIR, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' })
  db = createDb(url)
}, 300_000)

afterAll(async () => {
  await db?.$disconnect()
  await container?.stop()
})

describe('applySubscriptionEvent ordering', () => {
  it('applies a same-second .deleted after a .updated — the cancel that used to be dropped', async () => {
    const id = await tenantWithCustomer('SameSecond', 'cus_samesecond')
    expect(await apply('cus_samesecond', T, 'evt_1', UPDATED, update('active'))).toBe('applied')
    // Stripe's second event for the SAME cancel, same `created` second
    expect(await apply('cus_samesecond', T, 'evt_2', DELETED, update('canceled'))).toBe('applied')
    expect(await statusOf(id)).toBe('canceled')
  })

  it('applies TWO same-second .updated events — a plan change emits exactly that', async () => {
    // the rank comparison is `>=`, not `>`, precisely so equal-rank events still both land
    const id = await tenantWithCustomer('PlanChange', 'cus_planchange')
    expect(await apply('cus_planchange', T, 'evt_p1', UPDATED, update('active', 'sub_P'))).toBe('applied')
    expect(await apply('cus_planchange', T, 'evt_p2', UPDATED, { ...update('active', 'sub_P'), subscriptionPriceId: 'price_tsp_scale' })).toBe('applied')
    expect(await statusOf(id)).toBe('active')
  })

  it('a REORDERED same-second .updated cannot undo a .deleted', async () => {
    // Stripe does not guarantee delivery order, so the cancel can arrive FIRST. Ordering by arrival
    // would then leave a canceled customer `active`, entitled and unbilled — the expensive direction
    const id = await tenantWithCustomer('Reordered', 'cus_reordered')
    expect(await apply('cus_reordered', T, 'evt_del', DELETED, update('canceled'))).toBe('applied')
    expect(await apply('cus_reordered', T, 'evt_upd', UPDATED, update('active'))).toBe('stale')
    expect(await statusOf(id)).toBe('canceled')
  })

  it('a RETRY of an already-applied event is dropped even after other events have landed', async () => {
    // the single-slot `lastBillingEventId` this replaced remembered only the PREVIOUS event, so this
    // exact sequence — an ordinary Stripe retry after a lost 200 — resurrected the subscription
    const id = await tenantWithCustomer('Retry', 'cus_retry')
    expect(await apply('cus_retry', T, 'evt_u', UPDATED, update('active'))).toBe('applied')
    expect(await apply('cus_retry', T, 'evt_d', DELETED, update('canceled'))).toBe('applied')
    expect(await apply('cus_retry', T, 'evt_u', UPDATED, update('active'))).toBe('stale')
    expect(await statusOf(id)).toBe('canceled')
    // …and it stays dropped however many times Stripe retries it
    expect(await apply('cus_retry', T, 'evt_u', UPDATED, update('active'))).toBe('stale')
    expect(await statusOf(id)).toBe('canceled')
  })

  it('drops a REDELIVERY of the same event — same second, same id', async () => {
    const id = await tenantWithCustomer('Redelivery', 'cus_redelivery')
    expect(await apply('cus_redelivery', T, 'evt_dup', UPDATED, update('active'))).toBe('applied')
    expect(await apply('cus_redelivery', T, 'evt_dup', UPDATED, update('canceled'))).toBe('stale')
    expect(await statusOf(id)).toBe('active')
  })

  it('drops an OLDER event whatever its id — out-of-order delivery must not roll state back', async () => {
    const id = await tenantWithCustomer('Older', 'cus_older')
    expect(await apply('cus_older', T, 'evt_now', DELETED, update('canceled'))).toBe('applied')
    expect(await apply('cus_older', EARLIER, 'evt_old', UPDATED, update('active'))).toBe('stale')
    expect(await statusOf(id)).toBe('canceled')
  })

  it('applies a strictly NEWER event even when it ranks lower — a resubscribe is not a reorder', async () => {
    const id = await tenantWithCustomer('Newer', 'cus_newer')
    expect(await apply('cus_newer', T, 'evt_a', DELETED, update('canceled'))).toBe('applied')
    expect(await apply('cus_newer', LATER, 'evt_b', CREATED, update('active', 'sub_NEW'))).toBe('applied')
    expect(await statusOf(id)).toBe('active')
  })

  it('a same-second cancel THEN resubscribe lands the new subscription — correct order, lower rank', async () => {
    // `.deleted`(A) then `.created`(B) in the same second is a cancel-and-resubscribe delivered in
    // the RIGHT order. Rank alone dropped it (created 0 < deleted 2), leaving a paying customer on
    // the canceled subscription: floored to zero entitlements AND classified as lapsed, so not even
    // metered. A lower rank for a DIFFERENT subscription is not a reorder of this one's lifecycle.
    const id = await tenantWithCustomer('Resub', 'cus_resub')
    expect(await apply('cus_resub', T, 'evt_rs_del', DELETED, update('canceled', 'sub_A'))).toBe('applied')
    expect(await apply('cus_resub', T, 'evt_rs_new', CREATED, update('active', 'sub_B'))).toBe('applied')
    const billing = await db.tenants.getBilling(id)
    expect(billing?.subscriptionStatus).toBe('active')
    expect(billing?.stripeSubscriptionId).toBe('sub_B')
  })

  it('…but a live event for the SAME subscription after its cancel is still a reorder, and drops', async () => {
    // the discriminator is the subscription id: `.updated`(A, active) after `.deleted`(A) in one
    // second is the reordered delivery, not a resubscribe
    const id = await tenantWithCustomer('SameSub', 'cus_samesub')
    expect(await apply('cus_samesub', T, 'evt_ss_del', DELETED, update('canceled', 'sub_A'))).toBe('applied')
    expect(await apply('cus_samesub', T, 'evt_ss_upd', UPDATED, update('active', 'sub_A'))).toBe('stale')
    expect(await statusOf(id)).toBe('canceled')
  })

  it('THREE same-second events cannot wedge the tenant onto a DELETED subscription', async () => {
    // the sequence that made the resubscribe hatch dangerous: after `deleted(A) → created(B)` the
    // rank slot held B's rank 0, so a reordered `updated(A, active)` passed the ordinary rank clause
    // and moved the tenant back onto the DELETED sub_A — as `active`, unlimited, and unrecoverable:
    // sub_A emits nothing ever again, and every later sub_B event is non-live and blocked by the
    // per-subscription guard. Free service that neither the lapse sweep nor the meter can see.
    const id = await tenantWithCustomer('Wedge', 'cus_wedge')
    expect(await apply('cus_wedge', T, 'evt_w_del_a', DELETED, update('canceled', 'sub_A'))).toBe('applied')
    expect(await apply('cus_wedge', T, 'evt_w_new_b', CREATED, update('active', 'sub_B'))).toBe('applied')
    expect(await apply('cus_wedge', T, 'evt_w_upd_a', UPDATED, update('active', 'sub_A'))).toBe('stale')
    expect((await db.tenants.getBilling(id))?.stripeSubscriptionId).toBe('sub_B')

    // …and the tenant is still cancelable: sub_B's own cancel lands
    expect(await db.tenants.applySubscriptionEvent(
      { stripeCustomerId: 'cus_wedge', id: 'evt_w_del_b', type: DELETED, at: new Date('2026-08-19T10:00:00.000Z') },
      update('canceled', 'sub_B'),
    )).toBe('applied')
    expect(await statusOf(id)).toBe('canceled')
  })

  it('a same-second cancel of an OLD subscription still cannot kill the live one', async () => {
    // the per-subscription guard has to survive the same-second admission: cancel A → resubscribe B,
    // then A's delayed cancel arrives stamped in B's second
    const id = await tenantWithCustomer('TwoSubs', 'cus_twosubs')
    expect(await apply('cus_twosubs', T, 'evt_b_created', CREATED, update('active', 'sub_B'))).toBe('applied')
    expect(await apply('cus_twosubs', T, 'evt_a_canceled', DELETED, update('canceled', 'sub_A'))).toBe('stale')
    const billing = await db.tenants.getBilling(id)
    expect(billing?.subscriptionStatus).toBe('active')
    expect(billing?.stripeSubscriptionId).toBe('sub_B')
  })

  it('an unknown customer id reports no_tenant rather than silently succeeding', async () => {
    expect(await apply('cus_nobody', T, 'evt_x', UPDATED, update('active'))).toBe('no_tenant')
  })

  it('an event that matched NO tenant is NOT recorded as applied — the reconciled retry must work', async () => {
    // the dedupe ledger is inside the transaction with the write, so a `no_tenant` outcome rolls it
    // back. Otherwise an admin fixing `stripeCustomerId` by hand (the documented remedy) would find
    // every redelivery silently dropped.
    expect(await apply('cus_unmapped', T, 'evt_unmapped', UPDATED, update('active'))).toBe('no_tenant')
    const id = await tenantWithCustomer('Reconciled', 'cus_unmapped')
    expect(await apply('cus_unmapped', T, 'evt_unmapped', UPDATED, update('active'))).toBe('applied')
    expect(await statusOf(id)).toBe('active')
  })
})

describe('subscriptionEventRank', () => {
  it('orders a state change the way Stripe emits it, and never leaves an unknown type last', () => {
    expect(subscriptionEventRank('customer.subscription.created')).toBeLessThan(subscriptionEventRank('customer.subscription.updated'))
    expect(subscriptionEventRank('customer.subscription.updated')).toBeLessThan(subscriptionEventRank('customer.subscription.deleted'))
    // an unknown type ranks WITH updated: ranking it above would let it overwrite a cancel, below
    // would let a cancel arriving after it be dropped
    expect(subscriptionEventRank('customer.subscription.paused')).toBe(subscriptionEventRank('customer.subscription.updated'))
  })
})

/**
 * The other half of the same billing state (audit MED #22): who is being served past their
 * entitlement floor. Nothing counted them, because the floor only bites at device-create time.
 */
describe('listLapsedTenants', () => {
  const NOW = new Date('2026-08-05T12:00:00.000Z')
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    // a Stripe subscription that lapsed
    const canceled = await db.tenants.create(actor, { name: 'Canceled Co' })
    await db.tenants.setStripeCustomer(canceled.id, 'cus_lapse_canceled')
    await apply('cus_lapse_canceled', new Date('2026-06-01T00:00:00Z'), 'evt_lc', DELETED, update('canceled', 'sub_C'))
    ids['canceled'] = canceled.id

    // a LOCAL self-serve trial that ran out: `trialing`, no Stripe subscription, period end past
    const trial = await db.tenants.createSelfServeSignup({
      tenantName: 'Expired Trial Co',
      accountName: 'Fleet',
      email: 'trial@expired.test',
      passwordHash: 'x',
      plan: 'direct_10',
      trialEndsAt: new Date('2026-07-01T00:00:00Z'),
      referredByAffiliateId: null,
    })
    ids['trial'] = trial.tenantId

    // a STRIPE-side trial: also `trialing` with a past period end, but it HAS a subscription behind
    // it — flooring this one would cut off a paying customer between the trial end and the webhook
    const stripeTrial = await db.tenants.create(actor, { name: 'Stripe Trial Co' })
    await db.tenants.setStripeCustomer(stripeTrial.id, 'cus_stripe_trial')
    await apply('cus_stripe_trial', new Date('2026-06-01T00:00:00Z'), 'evt_st', UPDATED, {
      stripeSubscriptionId: 'sub_T',
      subscriptionStatus: 'trialing',
      subscriptionPriceId: 'price_tsp_grow',
      currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
    })
    ids['stripeTrial'] = stripeTrial.id

    // a dunning tenant: past_due is a GRACE window, deliberately still entitled and still metered
    const dunning = await db.tenants.create(actor, { name: 'Dunning Co' })
    await db.tenants.setStripeCustomer(dunning.id, 'cus_dunning')
    await apply('cus_dunning', new Date('2026-06-01T00:00:00Z'), 'evt_d', UPDATED, update('past_due', 'sub_D'))
    ids['dunning'] = dunning.id
  })

  it('lists lapsed subscriptions and expired LOCAL trials — and neither past_due nor a Stripe trial', async () => {
    const rows = await db.tenants.listLapsedTenants(NOW)
    const found = new Set(rows.map((r) => r.tenantId))
    expect(found.has(ids['canceled']!)).toBe(true)
    expect(found.has(ids['trial']!)).toBe(true)
    // `past_due` is dunning grace: entitled, metered, NOT lapsed
    expect(found.has(ids['dunning']!)).toBe(false)
    // a Stripe-side trial reports `trialing` too; the stripeSubscriptionId discriminator is what
    // stops this sweep from listing a paying customer as a freeloader
    expect(found.has(ids['stripeTrial']!)).toBe(false)
  })

  it('says WHY and WHEN, so the count can be acted on rather than just watched', async () => {
    const rows = await db.tenants.listLapsedTenants(NOW)
    const canceled = rows.find((r) => r.tenantId === ids['canceled'])
    expect(canceled).toMatchObject({ reason: 'subscription_lapsed', subscriptionStatus: 'canceled', name: 'Canceled Co' })
    expect(canceled?.lapsedAt?.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    const trial = rows.find((r) => r.tenantId === ids['trial'])
    expect(trial).toMatchObject({ reason: 'trial_expired', subscriptionStatus: 'trialing' })
    expect(trial?.lapsedAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z') // the trial end, not a billing event
  })

  it('counts the devices still being ingested for free, ignoring retired ones', async () => {
    const tenantId = ids['canceled']!
    const account = await db.accounts.create({ tenantId }, actor, { name: 'Fleet' })
    const scope = { tenantId, accountId: account.id }
    const [prof] = await q<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'lapse','P') RETURNING id`)
    const device = { accountId: account.id, profileId: prof!.id }
    await db.devices.create(scope, actor, { ...device, imei: '860000000000101', name: 'Van 1' })
    const gone = await db.devices.create(scope, actor, { ...device, imei: '860000000000102', name: 'Van 2' })
    await db.devices.retire(scope, actor, gone.id.toString())
    const row = (await db.tenants.listLapsedTenants(NOW)).find((r) => r.tenantId === tenantId)
    expect(row?.activeDevices).toBe(1)
  })

  it('an evaluation BEFORE the trial ends does not list it — the clock is a parameter, not now()', async () => {
    const early = await db.tenants.listLapsedTenants(new Date('2026-06-15T00:00:00.000Z'))
    expect(early.some((r) => r.tenantId === ids['trial'])).toBe(false)
  })
})
