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
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

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
  const app = createApp({ ...common, stripe: fakeStripe })
  const appOff = createApp({ ...common }) // no stripe → not configured
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

  it('webhook state is per-tenant — one customer event never touches another tenant', async () => {
    const a = await freshTenant('PerA')
    const b = await freshTenant('PerB')
    await req(port, '/v1/billing/checkout', a.token, 'POST')
    await req(port, '/v1/billing/checkout', b.token, 'POST')
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_b', b.cus, 'customer.subscription.updated', 'active', 100), { 'stripe-signature': 'valid' })
    expect(((await (await req(port, '/v1/billing', b.token)).json()) as BillingView).active).toBe(true)
    expect(((await (await req(port, '/v1/billing', a.token)).json()) as BillingView).active).toBe(false) // A untouched
  })

  it('checkout while already subscribed is refused (double-billing guard) → 409', async () => {
    const { token, cus } = await freshTenant('Double')
    await req(port, '/v1/billing/checkout', token, 'POST')
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_a', cus, 'customer.subscription.updated', 'active', 100), { 'stripe-signature': 'valid' })
    const second = await req(port, '/v1/billing/checkout', token, 'POST')
    expect(second.status).toBe(409) // no second subscription created
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

  it('an unknown customer id in a webhook is a safe no-op', async () => {
    const res = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_unknown', 'cus_ghost', 'customer.subscription.updated', 'active'), { 'stripe-signature': 'valid' })
    expect(res.status).toBe(200) // acked, but nothing to update
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
