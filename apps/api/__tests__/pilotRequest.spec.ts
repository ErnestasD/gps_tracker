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
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
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

  it('honeypot: filled `website` gets a FAKE 200 and stores nothing', async () => {
    const res = await post({ ...VALID, email: 'bot@spam.test', website: 'https://spam.example' })
    expect(res.status).toBe(200) // the bot must not learn it was caught
    const leads = (await (await fetch(`${base()}/v1/platform/leads`, { headers: { authorization: `Bearer ${platformToken}` } })).json()) as { email: string }[]
    expect(leads.some((l) => l.email === 'bot@spam.test')).toBe(false)
  })

  it('garbage body → 400; oversize message → 400', async () => {
    expect((await post({ nonsense: true })).status).toBe(400)
    expect((await post({ ...VALID, message: 'x'.repeat(3000) })).status).toBe(400)
    expect((await post({ ...VALID, ref: 'not a slug!' })).status).toBe(400)
  })

  it('per-IP rate limit: the 6th request in the window → 429', async () => {
    await redis.del('pilot:rl:203.0.113.7') // clean slate for the counter
    for (let i = 0; i < 5; i++) expect((await post({ ...VALID, email: `u${i}@x.lt` })).status).toBe(201)
    expect((await post({ ...VALID, email: 'u6@x.lt' })).status).toBe(429)
  })
})
