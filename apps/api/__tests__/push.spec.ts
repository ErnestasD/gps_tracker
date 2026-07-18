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
const VAPID_PUBLIC = 'BFakeVapidPublicKeyForTests_0123456789abcdefghijklmnopqrstuvwxyz'

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let db: Db
let pool: Pool
let port: number
let httpServer: ReturnType<typeof createServer>
let acct1: string
let t1Admin: string // tenant-wide (no account) — push must reject (account_required)
let amA1: string // account_manager pinned to acct1 — the valid push caller
let readonlyKey: string // a read-only X-Api-Key (viewer scope)

const base = () => `http://127.0.0.1:${port}`
const jwtReq = (path: string, token: string | null, method = 'GET', body?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const keyReq = (path: string, key: string, method = 'GET', body?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { 'x-api-key': key, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p256dh-key-value', auth: 'auth-key-value' } })

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
  const s1 = await seedUser({ databaseUrl, email: 'a@p1.test', password: 'password12', role: 'tsp_admin', tenantName: 'P1', accountName: 'Fleet' })
  const sam = await seedUser({ databaseUrl, email: 'am@p1.test', password: 'password12', role: 'account_manager', tenantName: 'P1', accountName: 'Fleet' })
  acct1 = (await db.accounts.list({ tenantId: s1.tenantId }))[0]!.id
  t1Admin = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  amA1 = await mintTestToken({ userId: sam.userId, tenantId: s1.tenantId, accountId: acct1, role: 'account_manager' })

  const app = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1', vapidPublicKey: VAPID_PUBLIC })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))

  // a read-only integration key (viewer scope) to prove the writer guard on subscribe
  const k = (await (await jwtReq('/v1/api-keys', t1Admin, 'POST', { name: 'CI push' })).json()) as { key: string }
  readonlyKey = k.key
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('ADR-026 push routes', () => {
  it('GET /v1/push/vapid-key returns the configured public key with no-store', async () => {
    const res = await jwtReq('/v1/push/vapid-key', amA1)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await res.json()).toEqual({ key: VAPID_PUBLIC })
  })

  it('subscribe/unsubscribe require authentication (401 without a token)', async () => {
    expect((await jwtReq('/v1/push/subscribe', null, 'POST', sub('https://push.example.com/a'))).status).toBe(401)
    expect((await jwtReq('/v1/push/unsubscribe', null, 'POST', { endpoint: 'https://push.example.com/a' })).status).toBe(401)
  })

  it('a read-only X-Api-Key (viewer scope) is rejected on subscribe (403 — writer guard)', async () => {
    // vapid-key is a safe read → the key works there
    expect((await keyReq('/v1/push/vapid-key', readonlyKey)).status).toBe(200)
    // but subscribe MUTATES → requireRole(writers) rejects the viewer-scoped key
    expect((await keyReq('/v1/push/subscribe', readonlyKey, 'POST', sub('https://push.example.com/key'))).status).toBe(403)
  })

  it('a tenant-wide admin (no account in token) cannot subscribe — push targets an account (400)', async () => {
    const res = await jwtReq('/v1/push/subscribe', t1Admin, 'POST', sub('https://push.example.com/tenantwide'))
    expect(res.status).toBe(400)
  })

  it('an account-scoped caller subscribes its browser (201) and can unsubscribe (200)', async () => {
    const endpoint = 'https://push.example.com/good'
    expect((await jwtReq('/v1/push/subscribe', amA1, 'POST', sub(endpoint))).status).toBe(201)
    expect((await jwtReq('/v1/push/unsubscribe', amA1, 'POST', { endpoint })).status).toBe(200)
    // unsubscribe is idempotent — a repeat (or unknown endpoint) still resolves ok, no 404/500
    expect((await jwtReq('/v1/push/unsubscribe', amA1, 'POST', { endpoint })).status).toBe(200)
  })

  it('a malformed subscription body is a 400 (zod: missing keys / bad endpoint)', async () => {
    expect((await jwtReq('/v1/push/subscribe', amA1, 'POST', { endpoint: 'not-a-url' })).status).toBe(400)
    expect((await jwtReq('/v1/push/subscribe', amA1, 'POST', { endpoint: 'https://push.example.com/x' })).status).toBe(400) // keys missing
    expect((await jwtReq('/v1/push/unsubscribe', amA1, 'POST', {})).status).toBe(400) // endpoint missing
  })
})
