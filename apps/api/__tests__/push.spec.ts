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
let databaseUrl: string
let port: number
let httpServer: ReturnType<typeof createServer>
let acct1: string
let t1Admin: string // tenant-wide (no account) — subscribes at TENANT level (accountId NULL)
let amA1: string // account_manager pinned to acct1 — the valid push caller
let amB1: string // account_manager in a SECOND tenant — the cross-tenant steal case
let s1TenantId: string
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
  databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  db = createDb(databaseUrl)
  pool = createPool(databaseUrl)
  const s1 = await seedUser({ databaseUrl, email: 'a@p1.test', password: 'password12', role: 'tsp_admin', tenantName: 'P1', accountName: 'Fleet' })
  const sam = await seedUser({ databaseUrl, email: 'am@p1.test', password: 'password12', role: 'account_manager', tenantName: 'P1', accountName: 'Fleet' })
  // a SECOND tenant — the cross-tenant re-homing case had no coverage anywhere (push is manifest-EXEMPT)
  const s2 = await seedUser({ databaseUrl, email: 'a@p2.test', password: 'password12', role: 'tsp_admin', tenantName: 'P2', accountName: 'Other' })
  const acct2 = (await db.accounts.list({ tenantId: s2.tenantId }))[0]!.id
  acct1 = (await db.accounts.list({ tenantId: s1.tenantId }))[0]!.id
  s1TenantId = s1.tenantId
  t1Admin = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  amA1 = await mintTestToken({ userId: sam.userId, tenantId: s1.tenantId, accountId: acct1, role: 'account_manager' })
  amB1 = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, accountId: acct2, role: 'account_manager' })

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

  it('a tenant-wide admin subscribes at TENANT level and is fanned out to every account in it', async () => {
    // This used to 400 — "push targets an account" — which locked out exactly the people who run
    // the fleet. The row is now stored with accountId NULL, and the point is not the status code:
    // it is that the fan-out for an ACCOUNT must include it, or the tenant admin subscribes to
    // silence.
    const endpoint = 'https://push.example.com/tenantwide'
    const res = await jwtReq('/v1/push/subscribe', t1Admin, 'POST', sub(endpoint))
    expect(res.status).toBe(201)

    const targets = await db.pushSubscriptions.listByAccount(s1TenantId, acct1)
    expect(targets.map((t) => t.endpoint)).toContain(endpoint)
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

  it('another tenant cannot STEAL a push endpoint (409, and the owner keeps receiving)', async () => {
    // REGRESSION (audit MED): subscribe() upserted on the globally-unique endpoint with NO tenant
    // predicate, and its update branch rewrote tenantId/accountId/userId to the caller's. Any
    // account_manager in ANY tenant who learned an endpoint URL — a shared browser, a support
    // ticket pasting a PushSubscription JSON — silently took the row: the real owner stopped
    // receiving their own panic/geofence alerts, and the thief started receiving them. This was the
    // one mutation in the repo layer that could cross the tenant boundary.
    const endpoint = `https://push.example.com/steal-${Date.now()}`
    expect((await jwtReq('/v1/push/subscribe', amA1, 'POST', sub(endpoint))).status).toBe(201)
    expect((await jwtReq('/v1/push/subscribe', amB1, 'POST', sub(endpoint))).status).toBe(409)
    // the row is untouched — still tenant 1's, still deliverable to it
    const targets = await db.pushSubscriptions.listByAccount(s1TenantId, acct1)
    expect(targets.map((t) => t.endpoint)).toContain(endpoint)
  })

  it('CONCURRENT same-tenant subscribes all succeed — the tenant guard must not cost availability', async () => {
    // The first attempt at the tenant guard split the atomic upsert into claim-then-create. That
    // held the boundary but broke the legitimate path: two tabs, a double-clicked toggle or React
    // StrictMode all hand back the SAME endpoint from pushManager.getSubscription(), so the loser
    // got a spurious 409 — and apps/web/src/lib/push.ts calls `sub.unsubscribe()` on any throw,
    // destroying the browser subscription the winner had just registered. Push silently dead.
    const endpoint = `https://push.example.com/race-${Date.now()}`
    const results = await Promise.all(
      Array.from({ length: 4 }, () => jwtReq('/v1/push/subscribe', amA1, 'POST', sub(endpoint))),
    )
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201])
    const targets = await db.pushSubscriptions.listByAccount(s1TenantId, acct1)
    expect(targets.filter((t) => t.endpoint === endpoint)).toHaveLength(1)
  })

  it('re-subscribing WITHIN the tenant is still idempotent (the guard must not break renewal)', async () => {
    // browsers rotate push endpoints and re-subscribe on every load — a same-tenant repeat has to
    // keep updating the keys in place, which is exactly what the upsert was there for
    const endpoint = `https://push.example.com/rehome-${Date.now()}`
    expect((await jwtReq('/v1/push/subscribe', amA1, 'POST', sub(endpoint))).status).toBe(201)
    expect((await jwtReq('/v1/push/subscribe', amA1, 'POST', sub(endpoint))).status).toBe(201)
    const targets = await db.pushSubscriptions.listByAccount(s1TenantId, acct1)
    expect(targets.filter((t) => t.endpoint === endpoint)).toHaveLength(1) // one row, not two
  })

  it('deleting the USER removes their push subscriptions — a removed employee stops receiving alerts', async () => {
    // REGRESSION (audit MED). `push_subscriptions` had no FK, so a subscription outlived its user
    // and a `webpush` rule channel — which fans out to the ACCOUNT's rows — kept pushing that
    // account's vehicle positions and geofence alerts to a removed employee's browser, for as long
    // as the browser held the subscription. No API surface listed the row, either.
    const leaver = await seedUser({
      databaseUrl, email: `leaver-${Date.now()}@p1.test`, password: 'password12',
      role: 'account_manager', tenantName: 'P1', accountName: 'Fleet',
    })
    const token = await mintTestToken({ userId: leaver.userId, tenantId: leaver.tenantId, accountId: acct1, role: 'account_manager' })
    const endpoint = `https://push.example.com/leaver-${Date.now()}`
    expect((await jwtReq('/v1/push/subscribe', token, 'POST', sub(endpoint))).status).toBe(201)
    expect((await db.pushSubscriptions.listByAccount(s1TenantId, acct1)).some((t) => t.endpoint === endpoint)).toBe(true)

    await pool.query('DELETE FROM users WHERE id = $1', [leaver.userId])
    expect((await db.pushSubscriptions.listByAccount(s1TenantId, acct1)).some((t) => t.endpoint === endpoint)).toBe(false)
  })

  it('deleting the ACCOUNT removes its scheduled reports — no e-mails to an ex-customer', async () => {
    // Same class (audit MED): the worker's hourly cron reads `scheduled_reports` directly, so an
    // orphan kept running the report and e-mailing its recipients about an account that no longer
    // exists — invisible to every API read, all of which are tenant-scoped.
    const gone = await seedUser({
      databaseUrl, email: `sched-${Date.now()}@p1.test`, password: 'password12',
      role: 'tsp_admin', tenantName: 'SchedCo', accountName: 'SchedFleet',
    })
    const accounts = await db.accounts.list({ tenantId: gone.tenantId })
    const accountId = accounts[0]!.id
    await pool.query(
      `INSERT INTO scheduled_reports ("tenantId","accountId","reportType","cadence","hourUtc","recipients")
       VALUES ($1,$2,'trips','daily',6,ARRAY['ex@customer.test'])`,
      [gone.tenantId, accountId],
    )
    const count = async (): Promise<number> => {
      const r = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM scheduled_reports WHERE "accountId"=$1', [accountId])
      return r.rows[0]!.n
    }
    expect(await count()).toBe(1)
    await pool.query('DELETE FROM accounts WHERE id = $1', [accountId])
    expect(await count()).toBe(0)
  })
})