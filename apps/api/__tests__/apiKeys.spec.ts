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

const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')
const RATE = 3 // low per-key limit so the rate-limit test is cheap

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let db: Db
let pool: Pool
let port: number
let httpServer: ReturnType<typeof createServer>
let t1Admin: string
let t2Admin: string

const base = () => `http://127.0.0.1:${port}`
const jwtReq = (path: string, token: string, method = 'GET', body?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const keyReq = (path: string, key: string, method = 'GET', body?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { 'x-api-key': key, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })

async function createKey(adminToken: string, name = 'CI'): Promise<{ status: number; key?: string; id?: string }> {
  const res = await jwtReq('/v1/api-keys', adminToken, 'POST', { name })
  if (res.status !== 201) return { status: res.status }
  const b = (await res.json()) as { key: string; id: string }
  return { status: 201, key: b.key, id: b.id }
}

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
  const s1 = await seedUser({ databaseUrl, email: 'a@k1.test', password: 'password12', role: 'tsp_admin', tenantName: 'K1', accountName: 'Fleet' })
  const s2 = await seedUser({ databaseUrl, email: 'a@k2.test', password: 'password12', role: 'tsp_admin', tenantName: 'K2' })
  t1Admin = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  t2Admin = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })

  const app = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1', apiKeyRateLimitPerMin: RATE })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('E06-3 API keys', () => {
  it('a tenant admin mints a key; the plaintext is returned once with an orb_live_ prefix', async () => {
    const k = await createKey(t1Admin)
    expect(k.status).toBe(201)
    expect(k.key?.startsWith('orb_live_')).toBe(true)
  })

  it('the key authenticates a READ request (X-Api-Key)', async () => {
    const k = await createKey(t1Admin)
    const res = await keyReq('/v1/devices', k.key!)
    expect(res.status).toBe(200)
  })

  it('the key is READ-ONLY: it cannot write (403) and cannot mint keys (403)', async () => {
    const k = await createKey(t1Admin)
    const write = await keyReq('/v1/rules', k.key!, 'POST', { kind: 'panic', name: 'x', accountId: '00000000-0000-0000-0000-000000000000' })
    expect(write.status).toBe(403)
    const mint = await keyReq('/v1/api-keys', k.key!, 'POST', { name: 'escalate' })
    expect(mint.status).toBe(403)
  })

  it('an unknown / revoked key is 401', async () => {
    expect((await keyReq('/v1/devices', 'orb_live_deadbeef')).status).toBe(401)
    const k = await createKey(t1Admin)
    expect((await jwtReq(`/v1/api-keys/${k.id}`, t1Admin, 'DELETE')).status).toBe(200)
    expect((await keyReq('/v1/devices', k.key!)).status).toBe(401) // now revoked
  })

  it('isolation: tenant K2 admin cannot revoke a K1 key (404), and K1 cannot see K2 keys', async () => {
    const k = await createKey(t1Admin)
    expect((await jwtReq(`/v1/api-keys/${k.id}`, t2Admin, 'DELETE')).status).toBe(404)
    const list = (await (await jwtReq('/v1/api-keys', t2Admin)).json()) as { id: string }[]
    expect(list.some((x) => x.id === k.id)).toBe(false)
  })

  it('enforces the per-key rate limit (429 past the window budget)', async () => {
    const k = await createKey(t1Admin)
    const codes: number[] = []
    for (let i = 0; i < RATE + 1; i++) codes.push((await keyReq('/v1/devices', k.key!)).status)
    expect(codes.slice(0, RATE)).toEqual(Array(RATE).fill(200))
    expect(codes[RATE]).toBe(429)
  })

  it('an empty x-api-key header does not shadow a valid Bearer JWT (review LOW)', async () => {
    const res = await fetch(`${base()}/v1/devices`, { headers: { authorization: `Bearer ${t1Admin}`, 'x-api-key': '' } })
    expect(res.status).toBe(200) // falls through to the JWT path
  })

  it('a malformed / non-orb_live key is 401', async () => {
    expect((await keyReq('/v1/devices', 'garbage')).status).toBe(401)
  })

  it('a non-admin JWT cannot mint keys (403)', async () => {
    const viewer = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000aa', tenantId: '00000000-0000-0000-0000-0000000000bb', role: 'viewer' })
    expect((await jwtReq('/v1/api-keys', viewer, 'POST', { name: 'x' })).status).toBe(403)
  })
})
