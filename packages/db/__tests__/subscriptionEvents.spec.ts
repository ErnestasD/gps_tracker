import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '../src/index.js'

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
  it('applies a same-second event with a DIFFERENT id — the cancel that used to be dropped', async () => {
    const id = await tenantWithCustomer('SameSecond', 'cus_samesecond')
    expect(await db.tenants.applySubscriptionEvent('cus_samesecond', T, 'evt_1', update('active'))).toBe('applied')
    // Stripe's second event for the SAME cancel, same `created` second, different event id
    expect(await db.tenants.applySubscriptionEvent('cus_samesecond', T, 'evt_2', update('canceled'))).toBe('applied')
    expect(await statusOf(id)).toBe('canceled')
  })

  it('drops a REDELIVERY of the same event — same second, same id', async () => {
    const id = await tenantWithCustomer('Redelivery', 'cus_redelivery')
    expect(await db.tenants.applySubscriptionEvent('cus_redelivery', T, 'evt_dup', update('active'))).toBe('applied')
    // Stripe retries carry the SAME evt_ id; applying twice must be a no-op, which is what keeps the
    // same-second admission from turning into "apply everything twice"
    expect(await db.tenants.applySubscriptionEvent('cus_redelivery', T, 'evt_dup', update('canceled'))).toBe('stale')
    expect(await statusOf(id)).toBe('active')
  })

  it('drops an OLDER event whatever its id — out-of-order delivery must not roll state back', async () => {
    const id = await tenantWithCustomer('Older', 'cus_older')
    expect(await db.tenants.applySubscriptionEvent('cus_older', T, 'evt_now', update('canceled'))).toBe('applied')
    expect(await db.tenants.applySubscriptionEvent('cus_older', EARLIER, 'evt_old', update('active'))).toBe('stale')
    expect(await statusOf(id)).toBe('canceled')
  })

  it('applies a strictly NEWER event', async () => {
    const id = await tenantWithCustomer('Newer', 'cus_newer')
    expect(await db.tenants.applySubscriptionEvent('cus_newer', T, 'evt_a', update('active'))).toBe('applied')
    expect(await db.tenants.applySubscriptionEvent('cus_newer', LATER, 'evt_b', update('past_due'))).toBe('applied')
    expect(await statusOf(id)).toBe('past_due')
  })

  it('a same-second cancel of an OLD subscription still cannot kill the live one', async () => {
    // the per-subscription guard has to survive the same-second admission: cancel A → resubscribe B,
    // then A's delayed cancel arrives stamped in B's second
    const id = await tenantWithCustomer('TwoSubs', 'cus_twosubs')
    expect(await db.tenants.applySubscriptionEvent('cus_twosubs', T, 'evt_b_created', update('active', 'sub_B'))).toBe('applied')
    expect(await db.tenants.applySubscriptionEvent('cus_twosubs', T, 'evt_a_canceled', update('canceled', 'sub_A'))).toBe('stale')
    const billing = await db.tenants.getBilling(id)
    expect(billing?.subscriptionStatus).toBe('active')
    expect(billing?.stripeSubscriptionId).toBe('sub_B')
  })

  it('an unknown customer id reports no_tenant rather than silently succeeding', async () => {
    expect(await db.tenants.applySubscriptionEvent('cus_nobody', T, 'evt_x', update('active'))).toBe('no_tenant')
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
    await db.tenants.applySubscriptionEvent('cus_lapse_canceled', new Date('2026-06-01T00:00:00Z'), 'evt_lc', update('canceled', 'sub_C'))
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
    await db.tenants.applySubscriptionEvent('cus_stripe_trial', new Date('2026-06-01T00:00:00Z'), 'evt_st', {
      stripeSubscriptionId: 'sub_T',
      subscriptionStatus: 'trialing',
      subscriptionPriceId: 'price_tsp_grow',
      currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
    })
    ids['stripeTrial'] = stripeTrial.id

    // a dunning tenant: past_due is a GRACE window, deliberately still entitled and still metered
    const dunning = await db.tenants.create(actor, { name: 'Dunning Co' })
    await db.tenants.setStripeCustomer(dunning.id, 'cus_dunning')
    await db.tenants.applySubscriptionEvent('cus_dunning', new Date('2026-06-01T00:00:00Z'), 'evt_d', update('past_due', 'sub_D'))
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
