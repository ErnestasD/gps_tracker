import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
 * Partner (affiliate) self-service auth (F5). A partner is NOT a tenant user; this proves the separate
 * surface end-to-end: admin issues a set-password token → partner sets a password → logs in → reads
 * ONLY its own profile + commissions. Plus the security boundaries: bad/absent credentials, a non-active
 * partner, single-use tokens, and strict token-type isolation (a partner token can't reach a tenant
 * route and vice versa).
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

const base = () => `http://127.0.0.1:${port}`
const j = (path: string, method = 'GET', bodyObj?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base()}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}),
  })
const admin = (path: string, method = 'GET', bodyObj?: unknown) => j(path, method, bodyObj, { authorization: `Bearer ${platformToken}` })
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

/** create → activate an affiliate, issue a set-password token, set a password. Returns its id + creds. */
async function makePartner(email: string, password: string, status: 'active' | 'suspended' = 'active') {
  const a = (await (await admin('/v1/affiliates', 'POST', { name: email, email })).json()) as { id: string }
  await admin(`/v1/affiliates/${a.id}`, 'PATCH', { status })
  const { token } = (await (await admin(`/v1/affiliates/${a.id}/set-password-token`, 'POST')).json()) as { token: string }
  const set = await j('/v1/partner/set-password', 'POST', { token, password })
  expect(set.status).toBe(200)
  return { id: a.id, email, password }
}
const login = (email: string, password: string) => j('/v1/partner/login', 'POST', { email, password })

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

describe('partner self-service auth (F5)', () => {
  it('admin token → set-password → login → me shows the partner’s own profile', async () => {
    const p = await makePartner('acme@partner.co', 'partnerpass1')
    const res = await login(p.email, p.password)
    expect(res.status).toBe(200)
    const { accessToken } = (await res.json()) as { accessToken: string }
    expect(typeof accessToken).toBe('string')
    const me = await j('/v1/partner/me', 'GET', undefined, bearer(accessToken))
    expect(me.status).toBe(200)
    const body = (await me.json()) as { id: string; email: string; passwordHash?: string }
    expect(body.id).toBe(p.id)
    expect(body.email).toBe('acme@partner.co')
    expect('passwordHash' in body).toBe(false) // never leaks the hash
  })

  it('a partner sees ONLY its own commissions', async () => {
    const a = await makePartner('coma@partner.co', 'partnerpass1')
    const b = await makePartner('comb@partner.co', 'partnerpass1')
    const tenant = await db.tenants.create({ userId: '00000000-0000-0000-0000-0000000000f5' }, { name: 'Referred' })
    await db.affiliates.accrueCommission({ affiliateId: a.id, tenantId: tenant.id, amountCents: 500, currency: 'eur', sourceInvoiceId: 'in_partner_1' })
    const aTok = ((await (await login(a.email, a.password)).json()) as { accessToken: string }).accessToken
    const bTok = ((await (await login(b.email, b.password)).json()) as { accessToken: string }).accessToken
    const aList = (await (await j('/v1/partner/commissions', 'GET', undefined, bearer(aTok))).json()) as unknown[]
    const bList = (await (await j('/v1/partner/commissions', 'GET', undefined, bearer(bTok))).json()) as unknown[]
    expect(aList).toHaveLength(1)
    expect(bList).toHaveLength(0) // B never sees A's commission
  })

  it('a commission row carries the customer, the invoice base and the rate — not just an amount', async () => {
    const p = await makePartner('detail@partner.co', 'partnerpass1')
    const tenant = await db.tenants.create({ userId: '00000000-0000-0000-0000-0000000000f6' }, { name: 'Visible Customer Ltd' })
    await db.affiliates.accrueCommission({
      affiliateId: p.id, tenantId: tenant.id, amountCents: 2500, currency: 'eur',
      sourceInvoiceId: 'in_detail_1', ratePct: '25.00', baseAmountCents: 10000, paidAt: new Date('2026-03-02T10:00:00Z'),
    })
    const tok = ((await (await login(p.email, p.password)).json()) as { accessToken: string }).accessToken
    const [row] = (await (await j('/v1/partner/commissions', 'GET', undefined, bearer(tok))).json()) as {
      customer: string; baseAmountCents: number; ratePct: string; amountCents: number; at: string
    }[]
    // the whole point: the arithmetic is checkable — 10000 × 25% = 2500, from THIS customer
    expect(row?.customer).toBe('Visible Customer Ltd')
    expect(row?.baseAmountCents).toBe(10000)
    expect(row?.ratePct).toBe('25')
    expect(row?.amountCents).toBe(2500)
    expect(row?.at).toBe('2026-03-02T10:00:00.000Z') // when the CUSTOMER paid, not when we inserted
  })

  it('a partner sees ONLY the customers it referred, with their totals and window', async () => {
    const a = await makePartner('cusa@partner.co', 'partnerpass1')
    const b = await makePartner('cusb@partner.co', 'partnerpass1')
    const sys = { userId: '00000000-0000-0000-0000-0000000000f7' }
    const mine = await db.tenants.create(sys, { name: 'Mine Ltd', referredByAffiliateId: a.id })
    await db.tenants.create(sys, { name: 'Theirs Ltd', referredByAffiliateId: b.id }) // B's, must not appear
    await db.affiliates.accrueCommission({
      affiliateId: a.id, tenantId: mine.id, amountCents: 3000, currency: 'eur',
      sourceInvoiceId: 'in_cus_1', ratePct: '20.00', baseAmountCents: 15000, paidAt: new Date('2026-01-05T00:00:00Z'),
    })
    const aTok = ((await (await login(a.email, a.password)).json()) as { accessToken: string }).accessToken
    const rows = (await (await j('/v1/partner/customers', 'GET', undefined, bearer(aTok))).json()) as {
      name: string; totals: { currency: string; commissionableCents: number; earnedCents: number }[]
    }[]
    expect(rows.map((r) => r.name)).toEqual(['Mine Ltd']) // B's customer is not in A's list
    expect(rows[0]?.totals).toEqual([{ currency: 'eur', commissionableCents: 15000, earnedCents: 3000 }])
  })

  it('a customer paying in TWO currencies keeps both totals — neither silently replaces the other', async () => {
    const p = await makePartner('multi@partner.co', 'partnerpass1')
    const t = await db.tenants.create({ userId: '00000000-0000-0000-0000-0000000000f9' }, { name: 'Two Currencies Ltd', referredByAffiliateId: p.id })
    await db.affiliates.accrueCommission({ affiliateId: p.id, tenantId: t.id, amountCents: 1000, currency: 'eur', sourceInvoiceId: 'in_mc_eur', baseAmountCents: 5000 })
    await db.affiliates.accrueCommission({ affiliateId: p.id, tenantId: t.id, amountCents: 2000, currency: 'usd', sourceInvoiceId: 'in_mc_usd', baseAmountCents: 8000 })
    const tok = ((await (await login(p.email, p.password)).json()) as { accessToken: string }).accessToken
    const [row] = (await (await j('/v1/partner/customers', 'GET', undefined, bearer(tok))).json()) as {
      totals: { currency: string; commissionableCents: number; earnedCents: number }[]
    }[]
    // keyed by tenant ALONE, the second currency used to overwrite the first and vanish from the page
    expect([...(row?.totals ?? [])].sort((a, b) => a.currency.localeCompare(b.currency))).toEqual([
      { currency: 'eur', commissionableCents: 5000, earnedCents: 1000 },
      { currency: 'usd', commissionableCents: 8000, earnedCents: 2000 },
    ])
  })

  it('the window end shown to the partner is the one the accrual enforces, month-end included', async () => {
    const actor = { userId: '00000000-0000-0000-0000-00000000010a' }
    const p = await makePartner('window@partner.co', 'partnerpass1')
    await db.affiliates.update(actor, p.id, { commissionMonths: 6 })
    const t = await db.tenants.create(actor, { name: 'Month End Ltd', referredByAffiliateId: p.id })
    await db.tenants.setStripeCustomer(t.id, 'cus_monthend')
    // 31 August + 6 months: the accrual CLAMPS to 28 Feb. Naive month arithmetic overflows to 3 Mar,
    // which would promise the partner three days of earning the accrual refuses.
    await db.affiliates.accrueForPaidInvoice({
      stripeCustomerId: 'cus_monthend', invoiceId: 'in_win_1', amountPaidCents: 10000,
      currency: 'eur', paidAt: new Date('2026-08-31T09:00:00Z'),
    })
    const tok = ((await (await login(p.email, p.password)).json()) as { accessToken: string }).accessToken
    const [row] = (await (await j('/v1/partner/customers', 'GET', undefined, bearer(tok))).json()) as { windowEndsAt: string }[]
    expect(row?.windowEndsAt).toBe('2027-02-28T09:00:00.000Z')
    // and the boundary agrees: a payment exactly on the end still accrues, so the page must not
    // have called the window shut before it
    const onTheLine = await db.affiliates.accrueForPaidInvoice({
      stripeCustomerId: 'cus_monthend', invoiceId: 'in_win_2', amountPaidCents: 10000,
      currency: 'eur', paidAt: new Date('2027-02-28T09:00:00Z'),
    })
    expect(onTheLine).not.toBeNull()
  })

  it('login rejects wrong password, unknown email, an unset-password partner, and a non-active partner', async () => {
    const p = await makePartner('who@partner.co', 'partnerpass1')
    expect((await login(p.email, 'wrongpass1')).status).toBe(401)
    expect((await login('nobody@partner.co', 'partnerpass1')).status).toBe(401)
    // an affiliate with NO password set (never redeemed a token) cannot log in
    const noPw = (await (await admin('/v1/affiliates', 'POST', { name: 'NoPw', email: 'nopw@partner.co' })).json()) as { id: string }
    await admin(`/v1/affiliates/${noPw.id}`, 'PATCH', { status: 'active' })
    expect((await login('nopw@partner.co', 'partnerpass1')).status).toBe(401)
    // a suspended partner with a valid password still cannot log in
    const sus = await makePartner('sus@partner.co', 'partnerpass1', 'suspended')
    expect((await login(sus.email, sus.password)).status).toBe(401)
  })

  it('the per-IP ceiling stops an attacker who varies the email to dodge the per-credential key', async () => {
    // The per-(IP,email) key is a different key for every address tried, so on its own it bounds
    // nothing for someone who never repeats one — and each attempt still burns a full argon2id
    // verify on the shared semaphore. Mirror of the tenant-login finding (audit MED). The soft
    // ceiling is 60 failures/h per IP and every test in this file shares 127.0.0.1, so the counters
    // are cleared first to make the assertion about the RULE and not about what ran before it.
    await redis.del('partner:fail:ip:127.0.0.1', 'partner:attempt:ip:127.0.0.1')
    let blocked = 0
    for (let i = 0; i < 62 && blocked === 0; i++) {
      const res = await login(`ghost-${i}@partner.co`, 'partnerpass1') // never the same email twice
      if (res.status === 429) blocked = i
    }
    expect(blocked).toBeGreaterThan(0)
    await redis.del('partner:fail:ip:127.0.0.1', 'partner:attempt:ip:127.0.0.1')
  })

  it('a partner is never locked out of the portal by someone guessing at their email from one host', async () => {
    // Affiliate emails are the most public identifiers on the platform — they are printed on the
    // referral pages. An attempt-counting account ceiling would let anyone deny a partner their
    // portal for an hour; counting DISTINCT source IPs means it takes a botnet, not a script.
    const p = await makePartner('publicemail@partner.co', 'partnerpass1')
    await redis.del('partner:fail:ip:127.0.0.1', 'partner:attempt:ip:127.0.0.1')
    for (let i = 0; i < 40; i++) await login(p.email, 'wrongpass1')
    // the per-(IP,email) rule does throttle this host, so clear that one key and confirm the
    // ACCOUNT itself was never locked: a different source signs in with the correct password
    await redis.del(`partner:fail:127.0.0.1:${createHash('sha256').update(p.email).digest('hex').slice(0, 16)}`)
    expect((await login(p.email, p.password)).status).toBe(200)
    await redis.del('partner:fail:ip:127.0.0.1', 'partner:attempt:ip:127.0.0.1')
  })

  it('suspending a partner AFTER login revokes its live token immediately (review MED)', async () => {
    const p = await makePartner('revoke@partner.co', 'partnerpass1')
    const tok = ((await (await login(p.email, p.password)).json()) as { accessToken: string }).accessToken
    expect((await j('/v1/partner/me', 'GET', undefined, bearer(tok))).status).toBe(200)
    await admin(`/v1/affiliates/${p.id}`, 'PATCH', { status: 'suspended' })
    // the still-unexpired token no longer works — the guard re-checks live status
    expect((await j('/v1/partner/me', 'GET', undefined, bearer(tok))).status).toBe(401)
    expect((await j('/v1/partner/commissions', 'GET', undefined, bearer(tok))).status).toBe(401)
  })

  it('a set-password token is single-use and rejects garbage', async () => {
    const a = (await (await admin('/v1/affiliates', 'POST', { name: 'Once', email: 'once@partner.co' })).json()) as { id: string }
    const { token } = (await (await admin(`/v1/affiliates/${a.id}/set-password-token`, 'POST')).json()) as { token: string }
    expect((await j('/v1/partner/set-password', 'POST', { token, password: 'partnerpass1' })).status).toBe(200)
    expect((await j('/v1/partner/set-password', 'POST', { token, password: 'partnerpass2' })).status).toBe(400) // reused
    expect((await j('/v1/partner/set-password', 'POST', { token: 'deadbeef', password: 'partnerpass1' })).status).toBe(400) // unknown
  })

  it('token-type isolation: a partner token cannot reach tenant routes; a tenant token cannot reach partner routes', async () => {
    const p = await makePartner('iso@partner.co', 'partnerpass1')
    const partnerTok = ((await (await login(p.email, p.password)).json()) as { accessToken: string }).accessToken
    // a partner token on a tenant (platform) route → 401 (the tenant middleware rejects it — no `ten`)
    expect((await j('/v1/affiliates', 'GET', undefined, bearer(partnerTok))).status).toBe(401)
    expect((await j('/v1/devices', 'GET', undefined, bearer(partnerTok))).status).toBe(401)
    // a tenant token on a partner route → 401 (the partner guard rejects it — no `typ:partner`)
    expect((await j('/v1/partner/me', 'GET', undefined, bearer(platformToken))).status).toBe(401)
    // no/garbage bearer → 401
    expect((await j('/v1/partner/me')).status).toBe(401)
    expect((await j('/v1/partner/me', 'GET', undefined, bearer('garbage'))).status).toBe(401)
  })

  it('issuing a set-password token requires platform_admin + an existing affiliate', async () => {
    // unauthenticated
    expect((await j('/v1/affiliates/00000000-0000-0000-0000-0000000000aa/set-password-token', 'POST')).status).toBe(401)
    // authed but unknown affiliate → 404
    expect((await admin('/v1/affiliates/00000000-0000-0000-0000-0000000000aa/set-password-token', 'POST')).status).toBe(404)
  })
})
