import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'
import type { BillingView } from '@orbetra/shared'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import type { StripeEvent, StripeGateway } from '../src/billing/stripe.js'
import { randomUUID } from 'node:crypto'

import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'
import { seedProfiles } from '../../../packages/db/seed/profiles.js'

/** reasons a verified webhook provisioned nothing — the signal that used to not exist at all */
const unmatched: string[] = []
const partnerMails: { event: string; email: string; customer: string; locale: string; amount?: string }[] = []

/**
 * Billing API (ADR-024). A FAKE StripeGateway records calls and lets tests craft webhook events:
 * `constructEvent` treats the raw body as the event JSON and accepts only the signature 'valid', so
 * tests exercise the routes + webhook state machine WITHOUT the SDK, network, or real HMAC. We prove:
 * the browser can't set subscription state (only the signed webhook can); state is keyed by Stripe
 * customer id and stays per-tenant; billing is admin-only; and a keyless server degrades cleanly.
 */
const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let redisSub: Redis
let db: Db
let databaseUrl: string
let port: number
let portOff: number
/** device counts handed to the registry rebuild, and a switch to make that rebuild fail. */
const restored: number[] = []
let restoreFails = false
let httpServer: ReturnType<typeof createServer>
let httpServerOff: ReturnType<typeof createServer>

let t1: string
let t1Token: string
let t1Viewer: string

// seed a fresh tenant + admin token; its fake customer id is derived from the tenant id. Each
// stateful test uses its OWN tenant so the monotonic `lastBillingEventAt` guard never bleeds across
// tests (customer state persists in the shared db between tests).
async function freshTenant(name: string) {
  const s = await seedUser({ databaseUrl, email: `${name}@t.test`, password: 'password12', role: 'tsp_admin', tenantName: name })
  const token = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'tsp_admin' })
  return { tenantId: s.tenantId, token, cus: `cus_${s.tenantId.slice(0, 8)}` }
}

// a fake Stripe gateway: deterministic customer ids, records checkout/portal calls
const calls: { checkout: number; portal: number } = { checkout: 0, portal: 0 }
// 'price_test' behaves like a TSP plan (maps to an overage price) so checkout adds the 2nd line item
const fakeStripe: StripeGateway = {
  prices: ['price_test'],
  listPlans: () => Promise.resolve([{ priceId: 'price_test', productName: 'Direct 10', amount: 1500, currency: 'eur', interval: 'month' }]),
  ensureCustomer: ({ tenantId, existingCustomerId }) => Promise.resolve(existingCustomerId ?? `cus_${tenantId.slice(0, 8)}`),
  createCheckoutSession: ({ customerId }) => { calls.checkout++; return Promise.resolve(`https://checkout.test/${customerId}`) },
  createPortalSession: ({ customerId }) => { calls.portal++; return Promise.resolve(`https://portal.test/${customerId}`) },
  constructEvent: (raw, sig): StripeEvent => {
    if (sig !== 'valid') throw new Error('invalid signature')
    return JSON.parse(raw) as StripeEvent
  },
  overageFor: (b) => (b === 'price_test' ? 'price_over' : undefined),
  // 'price_test' grants the direct_10 tier (≠ the seed default tsp_grow, so a write is observable)
  planFor: (b) => (b === 'price_test' ? 'direct_10' : undefined),
}

const base = (p: number) => `http://127.0.0.1:${p}`
const req = (p: number, path: string, token: string | null, method = 'GET', bodyObj?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base(p)}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', origin: 'https://app.orbetra.test', ...headers },
    ...(bodyObj !== undefined ? { body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj) } : {}),
  })

// a subscription webhook event for a given customer id; `created` is the Unix-seconds ordering key.
// items carry the base price 'price_test' (∩ allowlist) so subscriptionPriceId is populated.
const subEvent = (id: string, customer: string, type: string, status: string, created = 1_700_000_000, periodEnd = 1_800_000_000): StripeEvent => ({
  id, type, created,
  data: { object: { id: `sub_${customer}`, customer, status, current_period_end: periodEnd, items: { data: [{ price: { id: 'price_test' } }] } } },
})

// an invoice.payment_succeeded event (F4 affiliate accrual): amount_paid in cents, one per invoice id
const invoiceEvent = (id: string, customer: string, invoiceId: string, amountPaid: number, created = 1_700_000_000): StripeEvent => ({
  id, type: 'invoice.payment_succeeded', created,
  data: { object: { id: invoiceId, customer, amount_paid: amountPaid, currency: 'eur' } },
})

// a charge.refunded event: `refunded: true` means the customer got the WHOLE payment back
const refundEvent = (id: string, invoiceId: string, full = true, customer = 'cus_refund', created = 1_700_000_100): StripeEvent => ({
  id, type: 'charge.refunded', created,
  data: { object: { id: `ch_${invoiceId}`, invoice: invoiceId, customer, refunded: full, amount: 5_000, amount_refunded: full ? 5_000 : 1_000 } },
})

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(240_000)
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  const opts = { maxRetriesPerRequest: null }
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  redisSub = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  db = createDb(databaseUrl)

  const s1 = await seedUser({ databaseUrl, email: 'a@t1.test', password: 'password12', role: 'tsp_admin', tenantName: 'T1' })
  t1 = s1.tenantId
  t1Token = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'tsp_admin' })
  t1Viewer = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'viewer' })

  const common = {
    redis, redisSub, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
  }
  const app = createApp({
    ...common,
    stripe: fakeStripe,
    onWebhookUnmatched: (r) => unmatched.push(r),
    // the "you earned X" notice — captured rather than queued, so the test can prove it fires
    // exactly once per commission and carries the PARTNER's language
    siteUrl: 'https://site.example',
    mail: {
      // the only one this test needs; the reset mail is exercised by auth.spec
      enqueueResetEmail: () => Promise.resolve(),
      enqueuePartnerEmail: (job) => {
        partnerMails.push(job)
        return Promise.resolve()
      },
    },
    // observed, and failable on demand, so the ORDER of the registry write vs the suspension flag
    // can be pinned — that order is the whole substance of the restore path
    restoreDevices: (devices) => {
      if (restoreFails) return Promise.reject(new Error('redis down'))
      restored.push(devices.length)
      return Promise.resolve()
    },
  })
  const appOff = createApp({ ...common }) // no stripe → not configured
  void restored
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
  httpServerOff = serve({ fetch: appOff.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  portOff = await new Promise<number>((r) => httpServerOff.on('listening', () => r((httpServerOff.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  httpServerOff?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await new Promise<void>((r) => httpServerOff.close(() => r()))
  await db.$disconnect()
  await redis.quit()
  await redisSub.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

beforeEach(async () => {
  await redis.flushall()
})

describe('billing lifecycle (ADR-024)', () => {
  it('a keyless server reports not-configured and 503s mutations', async () => {
    const view = (await (await req(portOff, '/v1/billing', t1Token)).json()) as BillingView
    expect(view.configured).toBe(false)
    expect((await req(portOff, '/v1/billing/checkout', t1Token, 'POST')).status).toBe(503)
  })

  it('checkout creates+persists a customer and returns a hosted url', async () => {
    const before = (await (await req(port, '/v1/billing', t1Token)).json()) as BillingView
    expect(before).toMatchObject({ configured: true, hasCustomer: false, active: false, status: null })

    const res = await req(port, '/v1/billing/checkout', t1Token, 'POST')
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    expect(url).toContain('https://checkout.test/cus_')

    const after = (await (await req(port, '/v1/billing', t1Token)).json()) as BillingView
    expect(after.hasCustomer).toBe(true) // customer id persisted by the route
  })

  it('a verified webhook that matches NO tenant is acked but LOUD (audit MED)', async () => {
    // `applySubscriptionEvent` returns false when it matched no row — the repo returns it precisely
    // so the caller can tell "applied" from "matched nothing", and the caller discarded it. Stripe
    // saw 200, never retried, and a paying customer stayed unprovisioned forever with no log and no
    // metric. Reachable for real: checkout creates the Stripe customer and persists it in two
    // steps, and the per-tenant lock around them falls through on a Redis blip.
    const before = unmatched.length
    const res = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_orphan', 'cus_nobody_has_this', 'customer.subscription.updated', 'active', 900), { 'stripe-signature': 'valid' })
    expect(res.status).toBe(200) // still acked — a retry cannot conjure a missing customer mapping
    expect(unmatched.slice(before)).toEqual(['no_tenant']) // …but it is now countable and alertable
  })

  it('a STALE or out-of-order event is NOT reported — the alert must not cry wolf', async () => {
    // The repo returns "did not apply" for three different reasons and the first draft treated them
    // all as no_tenant: the monotonic guard and the per-subscription guard drop replayed,
    // out-of-order and same-second deliveries BY DESIGN. On this suite's own corpus that was a 67%
    // false-positive rate on a `severity: critical` page — worse than having no alert.
    const { token, cus } = await freshTenant('StaleNoise')
    await req(port, '/v1/billing/checkout', token, 'POST') // persists the stripeCustomerId
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_new', cus, 'customer.subscription.updated', 'active', 5_000), { 'stripe-signature': 'valid' })
    const before = unmatched.length
    // an OLDER event for the same, existing customer — dropped by the monotonic guard
    const older = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_old', cus, 'customer.subscription.updated', 'past_due', 1_000), { 'stripe-signature': 'valid' })
    expect(older.status).toBe(200)
    expect(unmatched.slice(before)).toEqual([]) // the tenant EXISTS — nothing to page anyone about
  })

  it('subscription state is set ONLY by a signature-verified webhook', async () => {
    const { token, cus } = await freshTenant('SubOnly')
    await req(port, '/v1/billing/checkout', token, 'POST')

    // an invalid signature changes nothing → 400
    const bad = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_1', cus, 'customer.subscription.updated', 'active', 100), { 'stripe-signature': 'nope' })
    expect(bad.status).toBe(400)
    expect(((await (await req(port, '/v1/billing', token)).json()) as BillingView).status).toBeNull()

    // a valid subscription.updated activates the tenant
    const ok = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_2', cus, 'customer.subscription.updated', 'active', 200), { 'stripe-signature': 'valid' })
    expect(ok.status).toBe(200)
    const view = (await (await req(port, '/v1/billing', token)).json()) as BillingView
    expect(view).toMatchObject({ status: 'active', active: true })
    expect(view.currentPeriodEnd).not.toBeNull()

    // a later deleted event cancels it
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_3', cus, 'customer.subscription.deleted', 'canceled', 300), { 'stripe-signature': 'valid' })
    expect(((await (await req(port, '/v1/billing', token)).json()) as BillingView).active).toBe(false)
  })

  it('reads current_period_end from the subscription ITEMS (Stripe basil API, no top-level field)', async () => {
    const { token, cus } = await freshTenant('Basil')
    await req(port, '/v1/billing/checkout', token, 'POST')
    // a basil-style event: no top-level current_period_end, it lives on the item
    const basil: StripeEvent = {
      id: 'evt_basil', type: 'customer.subscription.updated', created: 400,
      data: { object: { id: 'sub_b', customer: cus, status: 'active', items: { data: [{ price: { id: 'price_test' }, current_period_end: 1_900_000_000 }] } } },
    }
    await req(port, '/v1/webhooks/stripe', null, 'POST', basil, { 'stripe-signature': 'valid' })
    const view = (await (await req(port, '/v1/billing', token)).json()) as BillingView
    expect(view.active).toBe(true)
    expect(view.currentPeriodEnd).toBe(new Date(1_900_000_000 * 1000).toISOString()) // read from items, not top-level
  })

  it('out-of-order + replayed webhooks never resurrect a canceled subscription (monotonic guard)', async () => {
    const { token, cus } = await freshTenant('Ordering')
    await req(port, '/v1/billing/checkout', token, 'POST')
    // canceled at t=200
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_c', cus, 'customer.subscription.deleted', 'canceled', 200), { 'stripe-signature': 'valid' })
    expect(((await (await req(port, '/v1/billing', token)).json()) as BillingView).active).toBe(false)
    // a STALE 'active' from t=100 arrives late (distinct event id, so no id-based dedupe would catch it)
    const stale = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_stale', cus, 'customer.subscription.updated', 'active', 100), { 'stripe-signature': 'valid' })
    expect(stale.status).toBe(200) // acked...
    expect(((await (await req(port, '/v1/billing', token)).json()) as BillingView).active).toBe(false) // ...but ignored
    // a replay of the canceled event (same t=200) is a no-op — still canceled
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_c', cus, 'customer.subscription.deleted', 'canceled', 200), { 'stripe-signature': 'valid' })
    expect(((await (await req(port, '/v1/billing', token)).json()) as BillingView).status).toBe('canceled')
  })

  it('a late event for an OLD subscription never clobbers the current LIVE one (audit P4 per-sub guard)', async () => {
    const { token, cus } = await freshTenant('Resub')
    await req(port, '/v1/billing/checkout', token, 'POST') // establishes the tenant's stripeCustomerId
    // an explicit-subscription-id event for one customer (resubscribe → two distinct sub ids)
    const forSub = (subId: string, evtId: string, type: string, status: string, created: number): StripeEvent => ({
      id: evtId, type, created,
      data: { object: { id: subId, customer: cus, status, current_period_end: 1_800_000_000, items: { data: [{ price: { id: 'price_test' } }] } } },
    })
    const post = (e: StripeEvent) => req(port, '/v1/webhooks/stripe', null, 'POST', e, { 'stripe-signature': 'valid' })
    const view = async () => (await (await req(port, '/v1/billing', token)).json()) as BillingView

    await post(forSub('sub_A', 'evt_a1', 'customer.subscription.updated', 'active', 100)) // A active
    await post(forSub('sub_A', 'evt_a2', 'customer.subscription.deleted', 'canceled', 200)) // A canceled
    await post(forSub('sub_B', 'evt_b1', 'customer.subscription.created', 'active', 300)) // resubscribed on B
    expect((await view()).active).toBe(true)
    // a LATE 'A deleted' with a NEWER timestamp than B — the per-customer monotonic guard alone would
    // apply it and cancel the tenant; the per-subscription guard must reject it (A ≠ current sub_B)
    const late = await post(forSub('sub_A', 'evt_a3', 'customer.subscription.deleted', 'canceled', 400))
    expect(late.status).toBe(200) // acked...
    expect((await view()).active).toBe(true) // ...but B's active subscription is preserved
    expect((await view()).status).toBe('active')
  })

  it('resubscribe delivered OUT OF ORDER (new-sub-active before old-sub-cancel) still ends active (per-sub guard mirror)', async () => {
    const { token, cus } = await freshTenant('Reorder')
    await req(port, '/v1/billing/checkout', token, 'POST')
    const forSub = (subId: string, evtId: string, type: string, status: string, created: number): StripeEvent => ({
      id: evtId, type, created,
      data: { object: { id: subId, customer: cus, status, current_period_end: 1_800_000_000, items: { data: [{ price: { id: 'price_test' } }] } } },
    })
    const post = (e: StripeEvent) => req(port, '/v1/webhooks/stripe', null, 'POST', e, { 'stripe-signature': 'valid' })
    const view = async () => (await (await req(port, '/v1/billing', token)).json()) as BillingView

    // DISTINCT event ids from the previous test on purpose: redelivery suppression is keyed on the
    // event id alone, platform-wide, exactly as Stripe's ids are globally unique. Reusing an id here
    // would be a fixture reusing a real-world impossibility, and the second use would be dropped.
    await post(forSub('sub_A', 'evt_ro_a1', 'customer.subscription.updated', 'active', 100)) // A active
    // B created (t=300) is delivered BEFORE A's cancel (t=200) — a LIVE event must win under monotonic
    await post(forSub('sub_B', 'evt_ro_b1', 'customer.subscription.created', 'active', 300))
    expect((await view()).active).toBe(true)
    // A's cancel (t=200) now arrives late: older than B's t=300 → the monotonic guard drops it
    await post(forSub('sub_A', 'evt_ro_a2', 'customer.subscription.deleted', 'canceled', 200))
    expect((await view()).active).toBe(true) // NOT clobbered — B stays active (would fail a blanket different-sub block)
  })

  it('a payment RESTORES a suspended tenant, and the registry is rebuilt BEFORE the flag comes off', async () => {
    // the single most customer-visible claim in the lapse ladder — "paying restores the feed within
    // one webhook" — had no test. The ORDER is the substance: clearing the flag first and then
    // failing the Redis write leaves the tenant marked not-suspended with a dark fleet, invisible to
    // both the restore pass (not suspended) and the ladder (they paid), until an API restart.
    const { token, cus } = await freshTenant('Restore')
    await req(port, '/v1/billing/checkout', token, 'POST')
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_susp', cus, 'customer.subscription.deleted', 'canceled', 100), { 'stripe-signature': 'valid' })
    const tenantId = (await db.tenants.tenantIdForCustomer(cus))!
    await db.tenants.suspend(tenantId, new Date())
    expect((await db.tenants.isSuspended(tenantId))).toBe(true)

    restored.length = 0
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_paid', cus, 'customer.subscription.updated', 'active', 200), { 'stripe-signature': 'valid' })
    expect(await db.tenants.isSuspended(tenantId)).toBe(false)
    expect(restored).toHaveLength(1) // the registry was rebuilt
    const view = (await (await req(port, '/v1/billing', token)).json()) as BillingView & { suspendedAt: string | null }
    expect(view.suspendedAt).toBeNull() // …and the banner is gone
  })

  it('a PLATFORM ADMIN can restore a suspended tenant by hand — the bank-transfer case', async () => {
    // Until this route existed, the only way back on the air was a Stripe payment landing on the
    // webhook. A customer who paid by transfer, or one cut off by our own mistake, was restored with
    // a psql UPDATE and a Redis rebuild typed from memory while they waited on the phone.
    const { cus, token: owner } = await freshTenant('ManualRestore')
    await req(port, '/v1/billing/checkout', owner, 'POST') // mints the customer mapping
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_mr', cus, 'customer.subscription.deleted', 'canceled', 100), { 'stripe-signature': 'valid' })
    const tenantId = (await db.tenants.tenantIdForCustomer(cus))!
    await db.tenants.suspend(tenantId, new Date())
    await db.tenants.markLapseNotice(tenantId, 3, new Date())
    const stageBefore = (await db.tenants.get(tenantId) as unknown as { lapseNoticeStage: number }).lapseNoticeStage

    // a REAL device on the fixture, because both new tests used to run against an empty fleet — so
    // `restoreTenantDevices` was called with [] and the registry write, the thing the docblock calls
    // "the whole thing", was never exercised (review LOW). That is how the dropped `device:config`
    // got past green tests.
    const account = await db.accounts.create({ tenantId }, { userId: randomUUID() }, { name: 'Ops' })
    const profiles = await seedProfiles(databaseUrl)
    const device = await db.devices.create({ tenantId }, { userId: randomUUID() }, {
      accountId: account.id, imei: '356307042999001', name: 'Van 1', profileId: profiles['fmb1xx']!, odometerSource: 'device',
    })
    await redis.del('device:config')

    const platform = await mintTestToken({ userId: randomUUID(), tenantId, role: 'platform_admin' })
    const res = await req(port, `/v1/tenants/${tenantId}/restore`, platform, 'POST')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { restored: number }).restored).toBe(1)
    expect(await db.tenants.isSuspended(tenantId)).toBe(false)
    // the registry is rebuilt WITH the trip config: handing the flat DB rows to activateDevice
    // typechecks and silently skips device:config, and the fleet then runs on default presence rules
    // and GPS odometry instead of CAN, with nothing to notice it by (review HIGH)
    const cfg = await redis.hget('device:config', String(device.id))
    expect(cfg).not.toBeNull()
    expect(JSON.parse(cfg!) as { odometerSource: string }).toMatchObject({ odometerSource: 'device' })

    // the warning ladder SURVIVES an override: zeroing it means the next sweep cannot suspend
    // (it needs stage >= 3), so every click would buy ~2 more days of free service and mail the
    // customer a fresh final warning (review HIGH)
    const after = await db.tenants.get(tenantId)
    expect((after as unknown as { lapseNoticeStage: number }).lapseNoticeStage).toBe(stageBefore)

    // idempotent: a second click reports it rather than pretending to have done something
    const again = (await (await req(port, `/v1/tenants/${tenantId}/restore`, platform, 'POST')).json()) as { alreadyActive?: boolean }
    expect(again.alreadyActive).toBe(true)

    // and it is filed on the PLATFORM trail — who re-enabled a fleet must be answerable later
    const trail = await db.audit.listPlatform({ take: 20 })
    expect(trail.some((e) => e.entity === 'tenant' && e.entityId === tenantId)).toBe(true)
  })

  it('a TENANT admin cannot restore anyone, including itself', async () => {
    // the route is the override for a human who knows why; a customer clearing their own suspension
    // would make the lapse ladder advisory
    const { cus, token } = await freshTenant('NoSelfRestore')
    await req(port, '/v1/billing/checkout', token, 'POST') // mints the customer mapping
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_nsr', cus, 'customer.subscription.deleted', 'canceled', 100), { 'stripe-signature': 'valid' })
    const tenantId = (await db.tenants.tenantIdForCustomer(cus))!
    await db.tenants.suspend(tenantId, new Date())
    expect((await req(port, `/v1/tenants/${tenantId}/restore`, token, 'POST')).status).toBe(403)
    expect(await db.tenants.isSuspended(tenantId)).toBe(true)
  })

  it('a FAILED registry rebuild leaves the tenant marked suspended — recoverable, not stranded', async () => {
    const { token, cus } = await freshTenant('RestoreFail')
    await req(port, '/v1/billing/checkout', token, 'POST')
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_sf1', cus, 'customer.subscription.deleted', 'canceled', 100), { 'stripe-signature': 'valid' })
    const tenantId = (await db.tenants.tenantIdForCustomer(cus))!
    await db.tenants.suspend(tenantId, new Date())
    restoreFails = true
    try {
      const res = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_sf2', cus, 'customer.subscription.updated', 'active', 200), { 'stripe-signature': 'valid' })
      expect(res.status).toBe(200) // Stripe is still acked — a retry cannot fix Redis
      // the flag SURVIVES, so tomorrow's sweep finishes the job; the opposite order would have left
      // this tenant permanently dark with nothing looking at it
      expect(await db.tenants.isSuspended(tenantId)).toBe(true)
    } finally {
      restoreFails = false
    }
    void token
  })

  it('webhook state is per-tenant — one customer event never touches another tenant', async () => {
    const a = await freshTenant('PerA')
    const b = await freshTenant('PerB')
    await req(port, '/v1/billing/checkout', a.token, 'POST')
    await req(port, '/v1/billing/checkout', b.token, 'POST')
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_b', b.cus, 'customer.subscription.updated', 'active', 100), { 'stripe-signature': 'valid' })
    expect(((await (await req(port, '/v1/billing', b.token)).json()) as BillingView).active).toBe(true)
    expect(((await (await req(port, '/v1/billing', a.token)).json()) as BillingView).active).toBe(false) // A untouched
  })

  it('an F2 self-serve LOCAL trial can still subscribe (canSubscribe + checkout allowed)', async () => {
    // a signup-created tenant: status 'trialing' with NO Stripe subscription behind it
    const signed = await db.tenants.createSelfServeSignup({
      tenantName: 'Trial Co', accountName: 'My fleet', email: 'trial-billing@fleet.test',
      passwordHash: 'x', plan: 'direct_10', trialEndsAt: new Date(Date.now() + 86_400_000), referredByAffiliateId: null,
    })
    const token = await mintTestToken({ userId: signed.userId, tenantId: signed.tenantId, role: 'tsp_admin' })
    const view = (await (await req(port, '/v1/billing', token)).json()) as BillingView
    expect(view.status).toBe('trialing')
    expect(view.active).toBe(true) // trialing counts as active for the badge…
    expect(view.localTrial).toBe(true)
    expect(view.canSubscribe).toBe(true) // …but the trial MUST be able to convert to paid
    // and checkout actually succeeds (no 409 already_subscribed)
    const res = await req(port, '/v1/billing/checkout', token, 'POST')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { url: string }).url).toContain('https://checkout.test/')
  })

  it('a STRIPE-side trial (has a subscription id) is still protected from double-subscribe', async () => {
    const { token, cus } = await freshTenant('StripeTrial')
    await req(port, '/v1/billing/checkout', token, 'POST')
    // a real Stripe trial arrives via the webhook and carries sub_<customer>
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_st', cus, 'customer.subscription.updated', 'trialing', 100), { 'stripe-signature': 'valid' })
    const view = (await (await req(port, '/v1/billing', token)).json()) as BillingView
    expect(view.status).toBe('trialing')
    expect(view.localTrial).toBe(false) // has a Stripe subscription id
    expect(view.canSubscribe).toBe(false)
    expect((await req(port, '/v1/billing/checkout', token, 'POST')).status).toBe(409)
  })

  it('checkout while already subscribed is refused (double-billing guard) → 409', async () => {
    const { token, cus } = await freshTenant('Double')
    await req(port, '/v1/billing/checkout', token, 'POST')
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_a', cus, 'customer.subscription.updated', 'active', 100), { 'stripe-signature': 'valid' })
    const second = await req(port, '/v1/billing/checkout', token, 'POST')
    expect(second.status).toBe(409) // no second subscription created
  })

  it('a CONCURRENT checkout is blocked by the per-tenant lock → 409 (audit LOW TOCTOU)', async () => {
    // status stays null (no webhook) so the double-billing status guard does NOT fire — this is the
    // exact TOCTOU window. A held lock (another in-flight checkout for this tenant) must 409 the racer.
    const { token, tenantId } = await freshTenant('Toctou')
    await redis.set(`billing:checkout:${tenantId}`, '1', 'EX', 30, 'NX') // simulate the in-flight peer
    const res = await req(port, '/v1/billing/checkout', token, 'POST')
    expect(res.status).toBe(409)
    expect((await res.json() as { detail?: string }).detail).toBe('checkout_in_progress')
  })

  it('the lock is RELEASED after creation so a later legit re-subscribe is not blocked', async () => {
    const { token } = await freshTenant('LockRelease')
    expect((await req(port, '/v1/billing/checkout', token, 'POST')).status).toBe(200)
    // no lock lingering → an immediate sequential attempt still creates a session (status still null)
    expect((await req(port, '/v1/billing/checkout', token, 'POST')).status).toBe(200)
  })

  // a payment failure (past_due) leaves the subscription in place; a second Checkout would open a
  // DUPLICATE subscription = double-billing. The guard must send these to the portal, not Checkout.
  for (const status of ['past_due', 'unpaid', 'incomplete', 'paused'] as const) {
    it(`checkout is refused for a live-but-nonactive subscription (${status}) → 409, no 2nd subscription`, async () => {
      const { token, cus } = await freshTenant(`Live-${status}`)
      await req(port, '/v1/billing/checkout', token, 'POST')
      await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent(`evt_${status}`, cus, 'customer.subscription.updated', status, 100), { 'stripe-signature': 'valid' })
      const before = calls.checkout
      const second = await req(port, '/v1/billing/checkout', token, 'POST')
      expect(second.status).toBe(409) // routed to portal, NOT a new subscription
      expect(calls.checkout).toBe(before) // createCheckoutSession was never invoked
    })
  }

  // a fully ENDED subscription (canceled / never-activated) IS re-subscribable — checkout proceeds.
  for (const status of ['canceled', 'incomplete_expired'] as const) {
    it(`checkout is allowed again after an ended subscription (${status}) → 200`, async () => {
      const { token, cus } = await freshTenant(`Ended-${status}`)
      await req(port, '/v1/billing/checkout', token, 'POST')
      await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent(`evt_end_${status}`, cus, 'customer.subscription.updated', status, 100), { 'stripe-signature': 'valid' })
      const res = await req(port, '/v1/billing/checkout', token, 'POST')
      expect(res.status).toBe(200) // no live subscription → a fresh one is allowed
    })
  }

  it('checkout rejects a price id outside the server allowlist (never trust the client)', async () => {
    const { token } = await freshTenant('BadPrice')
    const res = await req(port, '/v1/billing/checkout', token, 'POST', { priceId: 'price_attacker_free' })
    expect(res.status).toBe(400)
  })

  it('webhook records the base plan price id → listable for the usage reporter', async () => {
    const { token, tenantId, cus } = await freshTenant('PlanId')
    await req(port, '/v1/billing/checkout', token, 'POST')
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_pl', cus, 'customer.subscription.updated', 'active', 100), { 'stripe-signature': 'valid' })
    const subs = await db.tenants.listActiveSubscribers()
    const mine = subs.find((s) => s.tenantId === tenantId)
    expect(mine).toBeDefined()
    expect(mine?.subscriptionPriceId).toBe('price_test') // the base price from the subscription items
    expect(mine?.stripeCustomerId).toBe(cus)
  })

  it('webhook resolves the base price → tenant plan and persists it (planFor, WP4)', async () => {
    const { token, tenantId, cus } = await freshTenant('PlanWire')
    // a freshly seeded tenant starts on the DB default tier (tsp_grow), NOT the subscribed one
    expect(await db.tenants.getPlan(tenantId)).toBe('tsp_grow')
    await req(port, '/v1/billing/checkout', token, 'POST')
    // the subscription carries base price 'price_test' → planFor maps it to direct_10; only the
    // signature-verified webhook writes it (a bad signature above never reaches here)
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_plan', cus, 'customer.subscription.updated', 'active', 100), { 'stripe-signature': 'valid' })
    expect(await db.tenants.getPlan(tenantId)).toBe('direct_10')
  })

  it('an unknown customer id in a webhook is a safe no-op', async () => {
    const res = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_unknown', 'cus_ghost', 'customer.subscription.updated', 'active'), { 'stripe-signature': 'valid' })
    expect(res.status).toBe(200) // acked, but nothing to update
  })

  it('invoice.payment_succeeded accrues the affiliate commission for a referred tenant (F4), idempotently', async () => {
    const actor = { userId: '00000000-0000-0000-0000-0000000000f4' }
    const aff = await db.affiliates.create(actor, { name: 'Webhook Partner', email: 'wh@partner.co', code: 'WHOOK1', commissionPct: 20, commissionMonths: 12 })
    await db.affiliates.update(actor, aff.id, { status: 'active' })
    const tenant = await db.tenants.create(actor, { name: 'Referred via webhook', referredByAffiliateId: aff.id })
    await db.tenants.setStripeCustomer(tenant.id, 'cus_whook')

    const ok = await req(port, '/v1/webhooks/stripe', null, 'POST', invoiceEvent('evt_inv_1', 'cus_whook', 'in_whook_1', 5_000), { 'stripe-signature': 'valid' })
    expect(ok.status).toBe(200)
    const after = await db.affiliates.listCommissions(aff.id)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ amountCents: 1_000, tenantId: tenant.id, sourceInvoiceId: 'in_whook_1', status: 'pending' }) // 20% of 50.00

    // a duplicate delivery of the SAME invoice does NOT double-accrue
    await req(port, '/v1/webhooks/stripe', null, 'POST', invoiceEvent('evt_inv_1b', 'cus_whook', 'in_whook_1', 5_000), { 'stripe-signature': 'valid' })
    expect(await db.affiliates.listCommissions(aff.id)).toHaveLength(1)
  })

  it('a commission notice reaches the partner ONCE — a Stripe redelivery must not tell them twice', async () => {
    const actor = { userId: '00000000-0000-0000-0000-00000000ac01' }
    partnerMails.length = 0 // the capture is module-level and earlier tests in this file accrue too
    const aff = await db.affiliates.create(actor, { name: 'Notified Partner', email: 'notify@partner.co', code: 'NOTIFY1', commissionPct: 20, commissionMonths: 12 })
    await db.affiliates.update(actor, aff.id, { status: 'active', locale: 'lt' })
    const tenant = await db.tenants.create(actor, { name: 'Notifying Customer', referredByAffiliateId: aff.id })
    await db.tenants.setStripeCustomer(tenant.id, 'cus_notify')

    await req(port, '/v1/webhooks/stripe', null, 'POST', invoiceEvent('evt_note_1', 'cus_notify', 'in_note_1', 5_000), { 'stripe-signature': 'valid' })
    // the notice is fired off the response path — give the microtask + its two lookups a moment
    await new Promise((r) => setTimeout(r, 400))
    expect(partnerMails).toHaveLength(1)
    expect(partnerMails[0]).toMatchObject({ event: 'commission', email: 'notify@partner.co', customer: 'Notifying Customer' })
    // the PARTNER's language and its money formatting, not the customer's browser and not always en
    expect(partnerMails[0]?.locale).toBe('lt')
    expect(partnerMails[0]?.amount).toContain('10,00')

    // a redelivery of the same invoice accrues nothing (unique sourceInvoiceId) and must therefore
    // notify nothing — a partner told twice about one payment stops trusting the numbers
    await req(port, '/v1/webhooks/stripe', null, 'POST', invoiceEvent('evt_note_1b', 'cus_notify', 'in_note_1', 5_000), { 'stripe-signature': 'valid' })
    await new Promise((r) => setTimeout(r, 400))
    expect(partnerMails).toHaveLength(1)
  })

  it('a fully refunded invoice REVERSES its pending commission; a partial refund and a paid-out one do not', async () => {
    const actor = { userId: '00000000-0000-0000-0000-0000000000f8' }
    const aff = await db.affiliates.create(actor, { name: 'Refund Partner', email: 'rf@partner.co', code: 'RFND1', commissionPct: 20, commissionMonths: 12 })
    await db.affiliates.update(actor, aff.id, { status: 'active' })
    const tenant = await db.tenants.create(actor, { name: 'Refunded customer', referredByAffiliateId: aff.id })
    await db.tenants.setStripeCustomer(tenant.id, 'cus_refund')

    // three paid invoices → three pending commissions
    for (const n of [1, 2, 3]) {
      await req(port, '/v1/webhooks/stripe', null, 'POST', invoiceEvent(`evt_rf_${n}`, 'cus_refund', `in_rf_${n}`, 5_000), { 'stripe-signature': 'valid' })
    }
    const byInvoice = async (inv: string) => (await db.affiliates.listCommissions(aff.id)).find((c) => c.sourceInvoiceId === inv)

    // 1) full refund of a pending commission → void
    expect((await req(port, '/v1/webhooks/stripe', null, 'POST', refundEvent('evt_rfd_1', 'in_rf_1'), { 'stripe-signature': 'valid' })).status).toBe(200)
    expect((await byInvoice('in_rf_1'))?.status).toBe('void')
    // …and a redelivery of the same refund is a no-op, not an error
    expect((await req(port, '/v1/webhooks/stripe', null, 'POST', refundEvent('evt_rfd_1b', 'in_rf_1'), { 'stripe-signature': 'valid' })).status).toBe(200)

    // 2) PARTIAL refund → the commission stands; reducing it is a human's arithmetic, not a guess
    expect((await req(port, '/v1/webhooks/stripe', null, 'POST', refundEvent('evt_rfd_2', 'in_rf_2', false), { 'stripe-signature': 'valid' })).status).toBe(200)
    expect((await byInvoice('in_rf_2'))?.status).toBe('pending')

    // 3) already PAID OUT → left alone: that money is in the partner's bank, a void would hide a debt
    const three = await byInvoice('in_rf_3')
    await db.affiliates.setCommissionStatus(actor, three?.id ?? '', 'paid')
    expect((await req(port, '/v1/webhooks/stripe', null, 'POST', refundEvent('evt_rfd_3', 'in_rf_3'), { 'stripe-signature': 'valid' })).status).toBe(200)
    expect((await byInvoice('in_rf_3'))?.status).toBe('paid')
  })

  it('a refund that OVERTAKES its own accrual still blocks the commission', async () => {
    const actor = { userId: '00000000-0000-0000-0000-0000000000f9' }
    const aff = await db.affiliates.create(actor, { name: 'Race Partner', email: 'race@partner.co', code: 'RACE1', commissionPct: 20, commissionMonths: 12 })
    await db.affiliates.update(actor, aff.id, { status: 'active' })
    const tenant = await db.tenants.create(actor, { name: 'Raced customer', referredByAffiliateId: aff.id })
    await db.tenants.setStripeCustomer(tenant.id, 'cus_race')

    // Stripe does not guarantee ordering, and our own accrual 500s-and-retries on a DB fault — so
    // the refund really can land first. It leaves a tombstone on the invoice id.
    expect((await req(port, '/v1/webhooks/stripe', null, 'POST', refundEvent('evt_race_r', 'in_race_1', true, 'cus_race'), { 'stripe-signature': 'valid' })).status).toBe(200)
    // …and the accrual that arrives afterwards must NOT pay out on money the customer already has back
    expect((await req(port, '/v1/webhooks/stripe', null, 'POST', invoiceEvent('evt_race_i', 'cus_race', 'in_race_1', 5_000), { 'stripe-signature': 'valid' })).status).toBe(200)
    const owed = (await db.affiliates.listCommissions(aff.id)).filter((c) => c.status !== 'void')
    expect(owed).toHaveLength(0)
  })

  it('invoice.payment_succeeded for an UNREFERRED tenant accrues nothing (safe no-op)', async () => {
    const tenant = await db.tenants.create({ userId: '00000000-0000-0000-0000-0000000000f4' }, { name: 'Plain via webhook' })
    await db.tenants.setStripeCustomer(tenant.id, 'cus_plainwh')
    const ok = await req(port, '/v1/webhooks/stripe', null, 'POST', invoiceEvent('evt_inv_2', 'cus_plainwh', 'in_plain_1', 5_000), { 'stripe-signature': 'valid' })
    expect(ok.status).toBe(200) // acked, no commission anywhere
  })

  it('billing is admin-only — a viewer is forbidden', async () => {
    expect((await req(port, '/v1/billing', t1Viewer)).status).toBe(403)
    expect((await req(port, '/v1/billing/checkout', t1Viewer, 'POST')).status).toBe(403)
    expect((await req(port, '/v1/billing/plans', t1Viewer)).status).toBe(403)
  })

  it('lists the configured plans (keyless server → empty)', async () => {
    const plans = (await (await req(port, '/v1/billing/plans', t1Token)).json()) as { priceId: string; productName: string }[]
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ priceId: 'price_test', productName: 'Direct 10' })
    expect(await (await req(portOff, '/v1/billing/plans', t1Token)).json()).toEqual([]) // no keys → empty
  })

  it('portal 409s before a customer exists, then returns a url', async () => {
    const { token } = await freshTenant('Portal')
    expect((await req(port, '/v1/billing/portal', token, 'POST')).status).toBe(409)
    await req(port, '/v1/billing/checkout', token, 'POST')
    const res = await req(port, '/v1/billing/portal', token, 'POST')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { url: string }).url).toContain('https://portal.test/')
  })
})
