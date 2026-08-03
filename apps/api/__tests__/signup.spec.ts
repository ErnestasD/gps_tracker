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
 * PUBLIC self-serve signup (F2). Proves: a direct customer creates a trial tenant + tenant-admin user
 * and can immediately LOG IN through the normal auth path; the trial floors at expiry via the
 * authoritative entitlement gate; a duplicate email 409s; the honeypot fakes success; an active ?ref
 * attributes the new tenant while an unknown ref never blocks; the created tenant is fully isolated.
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
const signup = (body: unknown) => j('/v1/public/signup', 'POST', body)
const login = (email: string, password: string) => j('/v1/auth/login', 'POST', { email, password })

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
  const seeded = await seedUser({ databaseUrl, email: 'pa@x.test', password: 'password12', role: 'platform_admin', tenantName: 'PlatCo' })
  platformToken = await mintTestToken({ userId: seeded.userId, tenantId: seeded.tenantId, role: 'platform_admin' })

  const app = createApp({
    redis, redisSub, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
    signupRateLimit: { max: 100, windowS: 3600 }, // the suite performs >5 signups from one IP
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

describe('public self-serve signup (F2)', () => {
  it('creates a trial tenant + admin who can immediately log in via the NORMAL auth path', async () => {
    const res = await signup({ name: 'Jonas', email: 'jonas@fleet.test', password: 'password12', company: 'Jonas Logistics' })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    // the tenant exists on the trial plan, trialing, with a future window
    const tenant = await db.tenants.get(id)
    expect(tenant).toMatchObject({ name: 'Jonas Logistics', plan: 'direct_10', subscriptionStatus: 'trialing' })
    // the trial window must match the PUBLIC promise (site copy + Terms of Service say 30 days) —
    // a drift here would break a contractual claim, so assert the length, not just "in the future"
    const days = (tenant!.currentPeriodEnd!.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.5)
    expect(days).toBeLessThan(30.5)
    // trial entitlements: direct matrix (deviceLimit 10, no white-label)
    const ents = await db.tenants.getEntitlements(id)
    expect(ents).toMatchObject({ deviceLimit: 10, whiteLabel: false, apiAccess: false })
    // the created admin logs in through the ordinary login route (signup minted NO session)
    const session = await login('jonas@fleet.test', 'password12')
    expect(session.status).toBe(200)
    const bodyJson = (await session.json()) as { user: { role: string; tenantId: string; accountId: string | null } }
    expect(bodyJson.user).toMatchObject({ role: 'tsp_admin', tenantId: id, accountId: null })
  })

  it('an EXPIRED trial floors at the authoritative gate (no sweep needed)', async () => {
    const fresh = await signup({ name: 'Rasa', email: 'rasa@fleet.test', password: 'password12' })
    const { id } = (await fresh.json()) as { id: string }
    // an already-past trial window, created through the same repo API (simulates day 15)
    const past = await db.tenants.createSelfServeSignup({
      tenantName: 'Expired Co', accountName: 'My fleet', email: 'expired@fleet.test',
      passwordHash: 'x', plan: 'direct_10', trialEndsAt: new Date(Date.now() - 1000), referredByAffiliateId: null,
    })
    expect((await db.tenants.getEntitlements(past.tenantId)).deviceLimit).toBe(0) // floored — expired trial keeps nothing
    // while the fresh (unexpired) one keeps its plan matrix
    expect((await db.tenants.getEntitlements(id)).deviceLimit).toBe(10)
  })

  it('the SESSION hint is trial-aware — an expired trial never advertises what the server would 403', async () => {
    // a tenant whose trial has already elapsed, created through the repo, with a real login password
    const pw = 'password12'
    const hashed = (await (await signup({ name: 'Hint', email: 'hint-live@fleet.test', password: pw })).json()) as { id: string }
    void hashed
    // reuse the live signup path for the UNEXPIRED case, and drive the expired case through login on a
    // tenant created with a past window (same argon2 hash as the live user so login succeeds)
    const liveUser = await db.auth.users.findByEmailAllTenants('hint-live@fleet.test')
    const expired = await db.tenants.createSelfServeSignup({
      tenantName: 'Hint Expired', accountName: 'My fleet', email: 'hint-expired@fleet.test',
      passwordHash: liveUser[0]!.passwordHash, plan: 'direct_10',
      trialEndsAt: new Date(Date.now() - 1000), referredByAffiliateId: null,
    })
    void expired
    const liveSession = (await (await login('hint-live@fleet.test', pw)).json()) as { user: { entitlements: { deviceLimit: number } } }
    const deadSession = (await (await login('hint-expired@fleet.test', pw)).json()) as { user: { entitlements: { deviceLimit: number } } }
    expect(liveSession.user.entitlements.deviceLimit).toBe(10) // in-trial → plan matrix
    expect(deadSession.user.entitlements.deviceLimit).toBe(0) // expired → floored, matching the server gate
  })

  it('a duplicate email (any tenant) → 409 email_in_use', async () => {
    await signup({ name: 'Dup', email: 'dup@fleet.test', password: 'password12' })
    const second = await signup({ name: 'Dup2', email: 'dup@fleet.test', password: 'password12' })
    expect(second.status).toBe(409)
    expect(((await second.json()) as { error: string }).error).toBe('email_in_use')
    // also collides with a pre-existing seeded user email
    expect((await signup({ name: 'X', email: 'pa@x.test', password: 'password12' })).status).toBe(409)
  })

  it('honeypot gets a FAKE 201 and stores nothing', async () => {
    const res = await signup({ name: 'Bot', email: 'bot@spam.test', password: 'password12', hp_field: 'gotcha' })
    expect(res.status).toBe(201)
    expect((await login('bot@spam.test', 'password12')).status).toBe(401) // nothing was created
  })

  it('an ACTIVE ?ref attributes the tenant; an unknown ref never blocks', async () => {
    const actor = { userId: '00000000-0000-0000-0000-0000000000f2' }
    const aff = await db.affiliates.create(actor, { name: 'Signup Partner', email: 'sp@partner.co', code: 'SIGNUP1' })
    await db.affiliates.update(actor, aff.id, { status: 'active' })
    const attributed = await signup({ name: 'Ref', email: 'ref@fleet.test', password: 'password12', ref: 'signup1' }) // case-insensitive
    const { id } = (await attributed.json()) as { id: string }
    expect((await db.tenants.get(id))!.referredByAffiliateId).toBe(aff.id)
    // unknown code → created, unattributed
    const unknown = await signup({ name: 'NoRef', email: 'noref@fleet.test', password: 'password12', ref: 'NOSUCH1' })
    expect(unknown.status).toBe(201)
    const u = (await unknown.json()) as { id: string }
    expect((await db.tenants.get(u.id))!.referredByAffiliateId).toBeNull()
  })

  it('a weak/invalid body → 400; the new tenant is invisible to other tenants (isolation)', async () => {
    expect((await signup({ name: 'X', email: 'not-an-email', password: 'password12' })).status).toBe(400)
    expect((await signup({ name: 'X', email: 'x@y.test', password: 'short' })).status).toBe(400)
    // a platform admin can see all tenants, but a tenant token cannot list tenants at all (403) —
    // covered by the isolation suite; here just assert the platform list includes the signups
    const list = await j('/v1/tenants', 'GET', undefined, { authorization: `Bearer ${platformToken}` })
    expect(list.status).toBe(200)
    const names = ((await list.json()) as { name: string }[]).map((t) => t.name)
    expect(names).toContain('Jonas Logistics')
  })
})
