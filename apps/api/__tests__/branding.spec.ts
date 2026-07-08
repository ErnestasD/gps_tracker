import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { expectedTxt } from '../src/routes/tenantSelf.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

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

let t1: string
let t2: string
let t1Token: string
let t2Token: string
// injected DNS resolver — tests set the record content per domain
const txtRecords = new Map<string, string[][]>()

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
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

  const s1 = await seedUser({ databaseUrl, email: 'a@t1.test', password: 'password12', role: 'tsp_admin', tenantName: 'T1' })
  const s2 = await seedUser({ databaseUrl, email: 'a@t2.test', password: 'password12', role: 'tsp_admin', tenantName: 'T2' })
  t1 = s1.tenantId
  t2 = s2.tenantId
  t1Token = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: t2, role: 'tsp_admin' })

  const app = createApp({
    redis, redisSub, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
    resolveTxt: (host) => {
      const rec = txtRecords.get(host)
      return rec ? Promise.resolve(rec) : Promise.reject(new Error('ENOTFOUND'))
    },
    askRateLimit: { max: 5, windowS: 60 },
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

beforeEach(async () => {
  await redis.flushall()
  txtRecords.clear()
})

describe('E03-5 tenant branding (self, scoped)', () => {
  it('PATCH then GET reflects the branding; a hex-invalid color is rejected', async () => {
    const ok = await req('/v1/tenant/branding', t1Token, 'PATCH', { primary: '#ff8800', productName: 'T1 Track' })
    expect(ok.status).toBe(200)
    const got = (await (await req('/v1/tenant/branding', t1Token)).json()) as { branding: { primary: string } }
    expect(got.branding.primary).toBe('#ff8800')
    // CSS-injection attempt via a non-hex color → 400
    expect((await req('/v1/tenant/branding', t1Token, 'PATCH', { primary: 'red;}body{display:none' })).status).toBe(400)
    // non-https logo → 400
    expect((await req('/v1/tenant/branding', t1Token, 'PATCH', { logoUrl: 'http://x/logo.png' })).status).toBe(400)
  })

  it('branding is per-tenant — T2 never sees T1 branding', async () => {
    await req('/v1/tenant/branding', t1Token, 'PATCH', { productName: 'ONLY T1' })
    const t2got = (await (await req('/v1/tenant/branding', t2Token)).json()) as { branding: Record<string, unknown> }
    expect(t2got.branding['productName']).toBeUndefined()
  })
})

describe('E03-5 domains + DNS verify', () => {
  it('add domain returns a TXT record; verify succeeds only when the TXT matches', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'fleet.t1.test' })).json()) as { id: string; txtToken: string; txtRecord: string }
    expect(created.txtRecord).toBe(expectedTxt(created.txtToken))

    // no TXT yet → 400 not verified
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(400)

    // publish the wrong token → still 400
    txtRecords.set('fleet.t1.test', [['orbetra-verify=wrong']])
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')).status).toBe(400)

    // publish the right token → verified
    txtRecords.set('fleet.t1.test', [['orbetra-verify=' + created.txtToken]])
    const ok = await req(`/v1/tenant/domains/${created.id}/verify`, t1Token, 'POST')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { verified: boolean }).verified).toBe(true)
  })

  it('a tenant cannot verify/delete ANOTHER tenant’s domain → 404', async () => {
    const created = (await (await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'x.t1.test' })).json()) as { id: string }
    expect((await req(`/v1/tenant/domains/${created.id}/verify`, t2Token, 'POST')).status).toBe(404)
    expect((await req(`/v1/tenant/domains/${created.id}`, t2Token, 'DELETE')).status).toBe(404)
  })

  it('invalid domain string → 400', async () => {
    expect((await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'http://not a host' })).status).toBe(400)
  })
})

describe('E03-5 public branding by Host + Caddy ask', () => {
  async function verifiedDomain(tenantToken: string, domain: string): Promise<void> {
    const created = (await (await req('/v1/tenant/domains', tenantToken, 'POST', { domain })).json()) as { id: string; txtToken: string }
    txtRecords.set(domain, [['orbetra-verify=' + created.txtToken]])
    await req(`/v1/tenant/domains/${created.id}/verify`, tenantToken, 'POST')
  }

  it('GET /v1/branding resolves by Host to the right tenant; unknown host → {}', async () => {
    await req('/v1/tenant/branding', t1Token, 'PATCH', { productName: 'T1 Brand', primary: '#111111' })
    await req('/v1/tenant/branding', t2Token, 'PATCH', { productName: 'T2 Brand', primary: '#222222' })
    await verifiedDomain(t1Token, 'app.t1.test')
    await verifiedDomain(t2Token, 'app.t2.test')

    const b1 = (await (await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'app.t1.test' } })).json()) as { branding: { productName: string } }
    const b2 = (await (await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'app.t2.test' } })).json()) as { branding: { productName: string } }
    expect(b1.branding.productName).toBe('T1 Brand')
    expect(b2.branding.productName).toBe('T2 Brand')
    const unknown = (await (await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'nope.test' } })).json()) as Record<string, unknown>
    expect(unknown).toEqual({})
  })

  it('caddy-ask: 200 for a verified domain, 403 for unknown/unverified, 400 for a bad domain', async () => {
    await verifiedDomain(t1Token, 'live.t1.test')
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=live.t1.test`)).status).toBe(200)
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=evil.test`)).status).toBe(403)
    // an UNVERIFIED domain is still denied
    await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'pending.t1.test' })
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=pending.t1.test`)).status).toBe(403)
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=not-a-host`)).status).toBe(400)
  })

  it('caddy-ask is rate-limited per domain (max 5 in the test) → 429', async () => {
    for (let i = 0; i < 5; i++) expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=whatever.test`)).status).toBe(403)
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=whatever.test`)).status).toBe(429)
    // a DIFFERENT domain has its own bucket — not throttled by the above
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=other.test`)).status).toBe(403)
  })

  it('public routes need NO auth (Caddy has no bearer)', async () => {
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=x.test`)).status).not.toBe(401)
    expect((await fetch(`${base()}/v1/branding`, { headers: { 'x-forwarded-host': 'x.test' } })).status).toBe(200)
  })
})

describe('E03-5 hardening (adversarial review)', () => {
  it('a pending squat does NOT block the real owner: both add, first to prove DNS wins (MED)', async () => {
    const domain = 'contested.test'
    // T2 squats it first (pending, no DNS control)
    const squat = (await (await req('/v1/tenant/domains', t2Token, 'POST', { domain })).json()) as { id: string; txtToken: string }
    // T1 (the real owner) can STILL add it — pending is unique per tenant, not globally
    const mine = (await req('/v1/tenant/domains', t1Token, 'POST', { domain }))
    expect(mine.status).toBe(201)
    const owner = (await mine.json()) as { id: string; txtToken: string }

    // both tokens are published on the (shared) domain's TXT; T1 verifies → wins the slot
    txtRecords.set(domain, [['orbetra-verify=' + owner.txtToken], ['orbetra-verify=' + squat.txtToken]])
    expect((await req(`/v1/tenant/domains/${owner.id}/verify`, t1Token, 'POST')).status).toBe(200)
    // the ask endpoint now maps the domain to T1
    expect((await fetch(`${base()}/v1/internal/caddy-ask?domain=${domain}`)).status).toBe(200)

    // T2's verify now loses to the partial-unique guard → 409 (not a silent takeover)
    expect((await req(`/v1/tenant/domains/${squat.id}/verify`, t2Token, 'POST')).status).toBe(409)
  })

  it('the same tenant adding a domain twice → 409 (per-tenant uniqueness)', async () => {
    expect((await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'twice.t1.test' })).status).toBe(201)
    expect((await req('/v1/tenant/domains', t1Token, 'POST', { domain: 'twice.t1.test' })).status).toBe(409)
  })

  it('branding + domains are tenant-admin only: a viewer and an account_manager get 403', async () => {
    const viewer = await mintTestToken({ userId: 'v-user', tenantId: t1, role: 'viewer' })
    const mgr = await mintTestToken({ userId: 'm-user', tenantId: t1, role: 'account_manager', accountId: 'acc-x' })
    for (const tok of [viewer, mgr]) {
      expect((await req('/v1/tenant/branding', tok, 'PATCH', { productName: 'nope' })).status).toBe(403)
      expect((await req('/v1/tenant/domains', tok, 'POST', { domain: 'nope.test' })).status).toBe(403)
      expect((await req('/v1/tenant/domains', tok)).status).toBe(403)
    }
  })
})
