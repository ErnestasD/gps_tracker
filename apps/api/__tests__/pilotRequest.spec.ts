import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, createPool, type Db, type Pool } from '@orbetra/db'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * W9-S1 public pilot-request: the marketing site's only form. Unauthenticated by design
 * (EXEMPT in the isolation meta-test) — so the abuse posture IS the contract: honeypot
 * eats bots silently, the per-IP limit bounds floods, and reading leads is platform-only.
 */
const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let db: Db
let pool: Pool
let port: number
let httpServer: ReturnType<typeof createServer>
let proxiedServer: ReturnType<typeof createServer>
let proxiedPort: number
let platformToken: string
let tspToken: string

const base = () => `http://127.0.0.1:${port}`
const post = (bodyObj: unknown) =>
  fetch(`${base()}/v1/public/pilot-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyObj) })
const VALID = { name: 'Jonas', company: 'UAB Fleet', email: 'jonas@fleet.lt', deviceCount: '250', message: 'FMB920 fleet', ref: 'partner-1' }

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE).withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' }).withExposedPorts(5432).withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2)).withStartupTimeout(240_000).start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  const databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  db = createDb(databaseUrl)
  pool = createPool(databaseUrl)
  const s1 = await seedUser({ databaseUrl, email: 'pa@x.test', password: 'password12', role: 'platform_admin', tenantName: 'P' })
  platformToken = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'platform_admin' })
  tspToken = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })

  const app = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '203.0.113.7' })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))

  // a SECOND instance with trustProxy=true — models production behind Caddy, where every
  // request's socket peer is Caddy and the real client is the rightmost XFF entry
  const proxied = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: true, getRemoteAddr: () => '172.20.0.2' })
  proxiedServer = serve({ fetch: proxied.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  proxiedPort = await new Promise<number>((r) => proxiedServer.on('listening', () => r((proxiedServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  proxiedServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await new Promise<void>((r) => proxiedServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('W9-S1 POST /v1/public/pilot-request', () => {
  it('stores a valid lead (201) with the affiliate ref, readable by platform_admin only', async () => {
    const res = await post(VALID)
    expect(res.status).toBe(201)
    const listed = await fetch(`${base()}/v1/platform/leads`, { headers: { authorization: `Bearer ${platformToken}` } })
    expect(listed.status).toBe(200)
    const leads = (await listed.json()) as { email: string; ref: string | null }[]
    expect(leads.some((l) => l.email === 'jonas@fleet.lt' && l.ref === 'partner-1')).toBe(true)
    // tsp_admin is NOT platform — leads are cross-tenant sales data
    expect((await fetch(`${base()}/v1/platform/leads`, { headers: { authorization: `Bearer ${tspToken}` } })).status).toBe(403)
  })

  it('honeypot: filled hp_field gets an INDISTINGUISHABLE 201 (random id) and stores nothing', async () => {
    const res = await post({ ...VALID, email: 'bot@spam.test', hp_field: 'https://spam.example' })
    expect(res.status).toBe(201) // same shape as success — a bot can't A/B-detect the trap
    const j = (await res.json()) as { ok: boolean; id: string }
    expect(j.ok).toBe(true)
    expect(j.id).toMatch(/^[0-9a-f-]{36}$/) // a uuid, but NOT a stored lead
    const leads = (await (await fetch(`${base()}/v1/platform/leads`, { headers: { authorization: `Bearer ${platformToken}` } })).json()) as { id: string; email: string }[]
    expect(leads.some((l) => l.email === 'bot@spam.test')).toBe(false)
    expect(leads.some((l) => l.id === j.id)).toBe(false) // the fake id is not in the DB
  })

  it('garbage body → 400; oversize message → 400', async () => {
    expect((await post({ nonsense: true })).status).toBe(400)
    expect((await post({ ...VALID, message: 'x'.repeat(3000) })).status).toBe(400)
    expect((await post({ ...VALID, ref: 'not a slug!' })).status).toBe(400)
  })

  it('per-IP rate limit keys on the REAL client IP (rightmost XFF), 6th in window → 429', async () => {
    // trustProxy is false in this app instance, so the key is the injected remote addr —
    // distinct IPs get distinct buckets (proves keying, not just counting)
    await redis.del('pilot:rl:203.0.113.7')
    for (let i = 0; i < 5; i++) expect((await post({ ...VALID, email: `u${i}@x.lt` })).status).toBe(201)
    expect((await post({ ...VALID, email: 'u6@x.lt' })).status).toBe(429)
  })

  it('behind a proxy, distinct clients get distinct buckets via rightmost XFF (not Caddy IP)', async () => {
    const proxied = (xff: string, bodyObj: unknown) =>
      fetch(`http://127.0.0.1:${proxiedPort}/v1/public/pilot-request`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify(bodyObj) })
    await redis.del('pilot:rl:9.9.9.9', 'pilot:rl:8.8.8.8')
    // client A (rightmost = 9.9.9.9, spoofed leftmost ignored) exhausts its bucket…
    for (let i = 0; i < 5; i++) expect((await proxied('1.2.3.4, 9.9.9.9', { ...VALID, email: `a${i}@x.lt` })).status).toBe(201)
    expect((await proxied('1.2.3.4, 9.9.9.9', { ...VALID, email: 'a6@x.lt' })).status).toBe(429)
    // …a DIFFERENT client (8.8.8.8) is unaffected — proof the key is per real client, not global
    expect((await proxied('7.7.7.7, 8.8.8.8', { ...VALID, email: 'b1@x.lt' })).status).toBe(201)
  })
})
