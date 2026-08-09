import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * Affiliate management API (item 5 / W9 phase 3), PLATFORM level. Proves the platform_admin CRUD +
 * commission-review handlers over a real DB: auto-generated code, 409 on a duplicate code/email,
 * 404 on a missing id, and the tenant-admin RBAC gate (a non-platform_admin never reaches these).
 * The full cross-tenant 403 sweep is the isolation suite's job — here we assert the handler shapes.
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
let httpServer: ReturnType<typeof createServer>

let platformToken: string
let tenantToken: string

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}),
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

  const seeded = await seedUser({ databaseUrl, email: 'pa@x.test', password: 'password12', role: 'platform_admin', tenantName: 'PlatCo', accountName: 'Fleet' })
  platformToken = await mintTestToken({ userId: seeded.userId, tenantId: seeded.tenantId, role: 'platform_admin' })
  tenantToken = await mintTestToken({ userId: seeded.userId, tenantId: seeded.tenantId, role: 'tsp_admin' })

  const app = createApp({
    redis, redisSub, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
  })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await db.$disconnect()
  await redis.quit()
  await redisSub.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

describe('affiliate management API (platform)', () => {
  it('a tenant admin (non-platform_admin) is refused every affiliate route (403)', async () => {
    expect((await req('/v1/affiliates', tenantToken)).status).toBe(403)
    expect((await req('/v1/affiliates', tenantToken, 'POST', { name: 'X', email: 'x@x.co' })).status).toBe(403)
  })

  it('creates a partner with an auto-generated code + default commission terms', async () => {
    const res = await req('/v1/affiliates', platformToken, 'POST', { name: 'Acme Partners', email: 'acme@partner.co' })
    expect(res.status).toBe(201)
    const a = (await res.json()) as { id: string; code: string; status: string; commissionPct: string; commissionMonths: number }
    expect(a.status).toBe('pending')
    expect(a.code).toMatch(/^[A-Z2-9]{8}$/) // no ambiguous glyphs
    expect(Number(a.commissionPct)).toBe(20)
    expect(a.commissionMonths).toBe(12)
    // it now appears in the list
    const list = (await (await req('/v1/affiliates', platformToken)).json()) as { id: string }[]
    expect(list.some((x) => x.id === a.id)).toBe(true)
  })

  it('honours a custom code + terms, and 409s a duplicate code or email', async () => {
    const first = await req('/v1/affiliates', platformToken, 'POST', { name: 'Beta', email: 'beta@partner.co', code: 'BETA-1', commissionPct: 25, commissionMonths: 6 })
    expect(first.status).toBe(201)
    const b = (await first.json()) as { commissionPct: string; commissionMonths: number }
    expect(Number(b.commissionPct)).toBe(25)
    expect(b.commissionMonths).toBe(6)
    // duplicate code
    expect((await req('/v1/affiliates', platformToken, 'POST', { name: 'Dup', email: 'other@partner.co', code: 'BETA-1' })).status).toBe(409)
    // duplicate email
    expect((await req('/v1/affiliates', platformToken, 'POST', { name: 'Dup2', email: 'beta@partner.co', code: 'OTHER-1' })).status).toBe(409)
  })

  it('rejects out-of-range commission terms (400, not a silent clamp)', async () => {
    expect((await req('/v1/affiliates', platformToken, 'POST', { name: 'Bad', email: 'bad@partner.co', commissionPct: 150 })).status).toBe(400)
    expect((await req('/v1/affiliates', platformToken, 'POST', { name: 'Bad', email: 'bad2@partner.co', commissionMonths: 0 })).status).toBe(400)
    // a bad code charset is also rejected
    expect((await req('/v1/affiliates', platformToken, 'POST', { name: 'Bad', email: 'bad3@partner.co', code: 'has space' })).status).toBe(400)
  })

  it('activates a partner (status change) and 404s an unknown id', async () => {
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Gamma', email: 'gamma@partner.co' })).json()) as { id: string }
    const patched = await req(`/v1/affiliates/${a.id}`, platformToken, 'PATCH', { status: 'active' })
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { status: string }).status).toBe('active')
    expect((await req('/v1/affiliates/00000000-0000-0000-0000-0000000000ff', platformToken, 'PATCH', { status: 'active' })).status).toBe(404)
  })

  it('lists an affiliate commissions (empty for a fresh partner)', async () => {
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Delta', email: 'delta@partner.co' })).json()) as { id: string }
    const res = await req(`/v1/affiliates/${a.id}/commissions`, platformToken)
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown[]).toEqual([])
  })

  it('the registry carries each partner\u2019s customer counts and money, per currency', async () => {
    const actor = { userId: '00000000-0000-0000-0000-00000000ab01' }
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Stats Partner', email: 'stats@partner.co', commissionPct: 25, commissionMonths: 12 })).json()) as { id: string }
    // one customer paying (window open), one that never paid, and one whose window has closed
    const paying = await db.tenants.create(actor, { name: 'Paying Ltd', referredByAffiliateId: a.id })
    const never = await db.tenants.create(actor, { name: 'Never Paid Ltd', referredByAffiliateId: a.id })
    const closed = await db.tenants.create(actor, { name: 'Closed Window Ltd', referredByAffiliateId: a.id })
    await db.tenants.setStripeCustomer(paying.id, 'cus_stats_pay')
    await db.tenants.setStripeCustomer(closed.id, 'cus_stats_closed')
    await db.affiliates.update(actor, a.id, { status: 'active' })
    await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_stats_pay', invoiceId: 'in_stats_1', amountPaidCents: 20000, currency: 'eur', paidAt: new Date() })
    // a window anchored two years ago with a 12-month term is CLOSED — it must not count as earning
    await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_stats_closed', invoiceId: 'in_stats_2', amountPaidCents: 10000, currency: 'usd', paidAt: new Date(Date.now() - 730 * 86_400_000) })

    const list = (await (await req('/v1/affiliates', platformToken)).json()) as {
      id: string
      stats: { customers: number; notPaying: number; earning: number; money: { currency: string; earnedCents: number; paidCents: number; pendingCents: number }[] }
    }[]
    const row = list.find((r) => r.id === a.id)
    expect(row?.stats.customers).toBe(3)
    expect(row?.stats.notPaying).toBe(1) // `never` has no anchor
    expect(row?.stats.earning).toBe(1) // `closed` is anchored but its window has run out
    expect([...(row?.stats.money ?? [])].sort((x, y) => x.currency.localeCompare(y.currency))).toEqual([
      { currency: 'eur', earnedCents: 5000, paidCents: 0, pendingCents: 5000 },
      { currency: 'usd', earnedCents: 2500, paidCents: 0, pendingCents: 2500 },
    ])
    expect(never.id).not.toBe(closed.id) // both were created; the ids are used only for that
  })

  it('a SUSPENDED partner has nobody earning, however open their customers\u2019 windows are', async () => {
    const actor = { userId: '00000000-0000-0000-0000-00000000ab02' }
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Susp Partner', email: 'susp@partner.co', commissionPct: 20, commissionMonths: 12 })).json()) as { id: string }
    const cust = await db.tenants.create(actor, { name: 'Susp Customer', referredByAffiliateId: a.id })
    await db.tenants.setStripeCustomer(cust.id, 'cus_susp')
    await db.affiliates.update(actor, a.id, { status: 'active' })
    await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_susp', invoiceId: 'in_susp_1', amountPaidCents: 10000, currency: 'eur', paidAt: new Date() })
    const earningOf = async () =>
      ((await (await req('/v1/affiliates', platformToken)).json()) as { id: string; stats: { earning: number } }[]).find((r) => r.id === a.id)?.stats.earning
    expect(await earningOf()).toBe(1)

    // accrueForPaidInvoice refuses a non-active affiliate BEFORE it looks at the window, so pressing
    // Suspend must move the number next to the button — it used to keep reading 1
    await req(`/v1/affiliates/${a.id}`, platformToken, 'PATCH', { status: 'suspended' })
    expect(await earningOf()).toBe(0)
  })

  it('a refund tombstone does not become a phantom customer or a 0.00 money chip', async () => {
    const actor = { userId: '00000000-0000-0000-0000-00000000ab03' }
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Tomb Partner', email: 'tomb@partner.co' })).json()) as { id: string }
    await db.affiliates.update(actor, a.id, { status: 'active' })
    const cust = await db.tenants.create(actor, { name: 'Refunded Customer', referredByAffiliateId: a.id })
    await db.tenants.setStripeCustomer(cust.id, 'cus_tomb')
    // refund arrives before any accrual → a zero-amount void row exists for that invoice
    expect(await db.affiliates.voidCommissionForRefund('in_tomb_1', 'cus_tomb')).toBe('tombstoned')

    const row = ((await (await req('/v1/affiliates', platformToken)).json()) as {
      id: string
      stats: { customers: number; notPaying: number; money: unknown[] }
    }[]).find((r) => r.id === a.id)
    expect(row?.stats.customers).toBe(1) // the tenant, counted once — counts come from tenants, not commissions
    expect(row?.stats.notPaying).toBe(1)
    expect(row?.stats.money).toEqual([]) // "nothing earned yet", not a 0.00 EUR chip
  })

  it('the short link 404s when no site origin is configured — it never guesses a host', async () => {
    // this app is built WITHOUT siteUrl (see beforeAll). A marketing link that redirects somewhere
    // wrong is worse than one that is not there yet, and a default would be a guess.
    const res = await fetch(`http://127.0.0.1:${port}/r/ANYCODE1`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('a performance tier raises the rate on NEW accruals and never re-prices history', async () => {
    const actor = { userId: '00000000-0000-0000-0000-00000000ab04' }
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Tiered', email: 'tier@partner.co', commissionPct: 20, commissionMonths: 12 })).json()) as { id: string }
    await req(`/v1/affiliates/${a.id}`, platformToken, 'PATCH', { status: 'active', tierPct: 30, tierMinCustomers: 2 })

    const customer = async (n: number) => {
      const t = await db.tenants.create(actor, { name: `Tier Customer ${n}`, referredByAffiliateId: a.id })
      await db.tenants.setStripeCustomer(t.id, `cus_tier_${n}`)
      return t
    }
    const c1 = await customer(1)
    const c2 = await customer(2)

    // first customer's first payment: one paying customer, below the threshold → base rate
    await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_tier_1', invoiceId: 'in_tier_1', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date() })
    // second customer's first payment: the anchor is claimed BEFORE the rate is resolved, so this
    // invoice is the one that crosses the threshold and earns the higher rate itself
    await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_tier_2', invoiceId: 'in_tier_2', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date() })
    // …and a later invoice from the first customer earns it too
    await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_tier_1', invoiceId: 'in_tier_3', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date() })

    const byInvoice = new Map((await db.affiliates.listCommissions(a.id)).map((r) => [r.sourceInvoiceId, r]))
    expect(byInvoice.get('in_tier_1')?.amountCents).toBe(2_000) // 20% — one paying customer at the time
    expect(byInvoice.get('in_tier_2')?.amountCents).toBe(3_000) // 30% — this payment is the second
    expect(byInvoice.get('in_tier_3')?.amountCents).toBe(3_000)
    // the FIRST entry keeps the rate it was earned at: crossing a threshold pays more from then on
    // and never re-prices a line already recorded
    expect(byInvoice.get('in_tier_1')?.ratePct?.toString()).toBe('20')
    expect(byInvoice.get('in_tier_2')?.ratePct?.toString()).toBe('30')
    void c1
    void c2
  })

  it('HALF a tier is ignored — a rate with no threshold pays nothing and must not pretend to', async () => {
    const actor = { userId: '00000000-0000-0000-0000-00000000ab05' }
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Half Tier', email: 'half@partner.co', commissionPct: 20, commissionMonths: 12 })).json()) as { id: string }
    await req(`/v1/affiliates/${a.id}`, platformToken, 'PATCH', { status: 'active', tierPct: 30 }) // no threshold
    const t = await db.tenants.create(actor, { name: 'Half Tier Customer', referredByAffiliateId: a.id })
    await db.tenants.setStripeCustomer(t.id, 'cus_half')
    await db.affiliates.accrueForPaidInvoice({ stripeCustomerId: 'cus_half', invoiceId: 'in_half_1', amountPaidCents: 10_000, currency: 'eur', paidAt: new Date() })
    expect((await db.affiliates.listCommissions(a.id))[0]?.amountCents).toBe(2_000) // base, not 30%
  })

  it('404s marking an unknown commission paid', async () => {
    expect((await req('/v1/commissions/00000000-0000-0000-0000-0000000000ff', platformToken, 'PATCH', { status: 'paid' })).status).toBe(404)
  })

  it('attributes a new tenant to an ACTIVE referral code; an unknown/inactive code attributes to no one', async () => {
    const created = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Attr Co', email: 'attr@partner.co', code: 'ATTR-1' })).json()) as { id: string }
    // pending code → no attribution (getActiveByCode only matches active)
    const pendingRef = (await (await req('/v1/tenants', platformToken, 'POST', { name: 'T pending ref', ref: 'ATTR-1' })).json()) as { referredByAffiliateId: string | null }
    expect(pendingRef.referredByAffiliateId).toBeNull()
    // activate → the same code now attributes
    await req(`/v1/affiliates/${created.id}`, platformToken, 'PATCH', { status: 'active' })
    const active = (await (await req('/v1/tenants', platformToken, 'POST', { name: 'T active ref', ref: 'ATTR-1' })).json()) as { referredByAffiliateId: string | null }
    expect(active.referredByAffiliateId).toBe(created.id)
    // an unknown code is NOT an error — the tenant is created, attributed to no one
    const unknown = await req('/v1/tenants', platformToken, 'POST', { name: 'T no ref', ref: 'NOSUCHCODE' })
    expect(unknown.status).toBe(201)
    expect(((await unknown.json()) as { referredByAffiliateId: string | null }).referredByAffiliateId).toBeNull()
  })

  it('the API never returns a partner password hash (rule 12)', async () => {
    // REGRESSION (audit MED): list/get/create/update called findMany/findUnique with NO select, so
    // the full model — including the argon2id `passwordHash` for partner self-service login —
    // went straight to the client. Partners are THIRD PARTIES, not staff, and the codebase already
    // solved this shape twice (webhooks' readRedact, partner.ts's hand-picked fields).
    const created = await req('/v1/affiliates', platformToken, 'POST', { name: 'Hash Co', email: 'hash@partner.co', code: 'HASHCO1' })
    expect(created.status).toBe(201)
    const one = (await created.json()) as Record<string, unknown>
    expect(one).not.toHaveProperty('passwordHash')

    const list = (await (await req('/v1/affiliates', platformToken)).json()) as Record<string, unknown>[]
    for (const a of list) expect(a).not.toHaveProperty('passwordHash')
    const got = (await (await req(`/v1/affiliates/${String(one['id'])}`, platformToken)).json()) as Record<string, unknown>
    expect(got).not.toHaveProperty('passwordHash')
    const patched = await req(`/v1/affiliates/${String(one['id'])}`, platformToken, 'PATCH', { status: 'active' })
    expect((await patched.json()) as Record<string, unknown>).not.toHaveProperty('passwordHash')
  })
})
