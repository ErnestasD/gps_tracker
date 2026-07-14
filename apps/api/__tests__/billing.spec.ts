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
let port: number
let portOff: number
let httpServer: ReturnType<typeof createServer>
let httpServerOff: ReturnType<typeof createServer>

let t1: string
let t2: string
let t1Token: string
let t2Token: string
let t1Viewer: string

// a fake Stripe gateway: deterministic customer ids, records checkout/portal calls
const calls: { checkout: number; portal: number } = { checkout: 0, portal: 0 }
const fakeStripe: StripeGateway = {
  ensureCustomer: ({ tenantId, existingCustomerId }) => Promise.resolve(existingCustomerId ?? `cus_${tenantId.slice(0, 8)}`),
  createCheckoutSession: ({ customerId }) => { calls.checkout++; return Promise.resolve(`https://checkout.test/${customerId}`) },
  createPortalSession: ({ customerId }) => { calls.portal++; return Promise.resolve(`https://portal.test/${customerId}`) },
  constructEvent: (raw, sig): StripeEvent => {
    if (sig !== 'valid') throw new Error('invalid signature')
    return JSON.parse(raw) as StripeEvent
  },
}

const base = (p: number) => `http://127.0.0.1:${p}`
const req = (p: number, path: string, token: string | null, method = 'GET', bodyObj?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base(p)}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', origin: 'https://app.orbetra.test', ...headers },
    ...(bodyObj !== undefined ? { body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj) } : {}),
  })

// a subscription webhook event for a given customer id
const subEvent = (id: string, customer: string, type: string, status: string, periodEnd = 1_800_000_000): StripeEvent => ({
  id, type, data: { object: { id: `sub_${customer}`, customer, status, current_period_end: periodEnd } },
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
  const databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  const opts = { maxRetriesPerRequest: null }
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  redisSub = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  db = createDb(databaseUrl)

  const s1 = await seedUser({ databaseUrl, email: 'a@t1.test', password: 'password12', role: 'tsp_admin', tenantName: 'T1' })
  const s2 = await seedUser({ databaseUrl, email: 'a@t2.test', password: 'password12', role: 'tsp_admin', tenantName: 'T2' })
  t1 = s1.tenantId
  t2 = s2.tenantId
  t1Token = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: t2, role: 'tsp_admin' })
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
    // ensure T1 has a customer first
    await req(port, '/v1/billing/checkout', t1Token, 'POST')
    const cus = `cus_${t1.slice(0, 8)}`

    // an invalid signature changes nothing → 400
    const bad = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_1', cus, 'customer.subscription.updated', 'active'), { 'stripe-signature': 'nope' })
    expect(bad.status).toBe(400)
    expect(((await (await req(port, '/v1/billing', t1Token)).json()) as BillingView).status).toBeNull()

    // a valid subscription.updated activates the tenant
    const ok = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_2', cus, 'customer.subscription.updated', 'active'), { 'stripe-signature': 'valid' })
    expect(ok.status).toBe(200)
    const view = (await (await req(port, '/v1/billing', t1Token)).json()) as BillingView
    expect(view).toMatchObject({ status: 'active', active: true })
    expect(view.currentPeriodEnd).not.toBeNull()

    // a deleted event cancels it
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_3', cus, 'customer.subscription.deleted', 'canceled'), { 'stripe-signature': 'valid' })
    expect(((await (await req(port, '/v1/billing', t1Token)).json()) as BillingView).active).toBe(false)
  })

  it('a replayed webhook event id is a no-op (idempotent)', async () => {
    await req(port, '/v1/billing/checkout', t1Token, 'POST')
    const cus = `cus_${t1.slice(0, 8)}`
    const first = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_dup', cus, 'customer.subscription.updated', 'past_due'), { 'stripe-signature': 'valid' })
    expect(first.status).toBe(200)
    const dup = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_dup', cus, 'customer.subscription.updated', 'active'), { 'stripe-signature': 'valid' })
    expect(await dup.text()).toBe('duplicate')
    // the replay (which claimed 'active') must NOT overwrite — state stays at the first event's 'past_due'
    expect(((await (await req(port, '/v1/billing', t1Token)).json()) as BillingView).status).toBe('past_due')
  })

  it('webhook state is per-tenant — a T2 customer event never touches T1', async () => {
    await req(port, '/v1/billing/checkout', t1Token, 'POST')
    await req(port, '/v1/billing/checkout', t2Token, 'POST')
    const cus2 = `cus_${t2.slice(0, 8)}`
    await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_t2', cus2, 'customer.subscription.updated', 'active'), { 'stripe-signature': 'valid' })
    expect(((await (await req(port, '/v1/billing', t2Token)).json()) as BillingView).active).toBe(true)
    expect(((await (await req(port, '/v1/billing', t1Token)).json()) as BillingView).active).toBe(false) // T1 untouched
  })

  it('an unknown customer id in a webhook is a safe no-op', async () => {
    const res = await req(port, '/v1/webhooks/stripe', null, 'POST', subEvent('evt_unknown', 'cus_ghost', 'customer.subscription.updated', 'active'), { 'stripe-signature': 'valid' })
    expect(res.status).toBe(200) // acked, but nothing to update
  })

  it('billing is admin-only — a viewer is forbidden', async () => {
    expect((await req(port, '/v1/billing', t1Viewer)).status).toBe(403)
    expect((await req(port, '/v1/billing/checkout', t1Viewer, 'POST')).status).toBe(403)
  })

  it('portal 409s before a customer exists, then returns a url', async () => {
    // fresh redis but db customer persists across tests; use a path where we control it: T-portal
    const sp = await seedUser({ databaseUrl: `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`, email: 'p@t.test', password: 'password12', role: 'tsp_admin', tenantName: 'TP' })
    const tok = await mintTestToken({ userId: sp.userId, tenantId: sp.tenantId, role: 'tsp_admin' })
    expect((await req(port, '/v1/billing/portal', tok, 'POST')).status).toBe(409)
    await req(port, '/v1/billing/checkout', tok, 'POST')
    const res = await req(port, '/v1/billing/portal', tok, 'POST')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { url: string }).url).toContain('https://portal.test/')
  })
})
