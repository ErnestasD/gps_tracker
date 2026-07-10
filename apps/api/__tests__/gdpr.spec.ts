import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, createPool, type Db, type Pool } from '@orbetra/db'

import { seedProfiles } from '../../../packages/db/seed/profiles.js'
import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * E08-4 GDPR API: device erase (retired-only, admin-only, enqueued) + account export
 * (job row + enqueue + scoped status/download). The BullMQ producer is faked — queue
 * consumption is the worker's spec; this proves the HTTP contract + RBAC + scoping.
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
let t1Token: string
let t2Token: string
let viewerToken: string
let managerToken: string
let accountId: string
let liveId: string
let retiredId: string
let freshRetiredId: string
const erased: { deviceId: string; tenantId: string }[] = []
const exported: { exportId: string }[] = []

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}) })

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
  await seedProfiles(databaseUrl)
  const s1 = await seedUser({ databaseUrl, email: 'a@c1.test', password: 'password12', role: 'tsp_admin', tenantName: 'C1', accountName: 'Fleet' })
  const s2 = await seedUser({ databaseUrl, email: 'a@c2.test', password: 'password12', role: 'tsp_admin', tenantName: 'C2' })
  accountId = (await db.accounts.list({ tenantId: s1.tenantId }))[0]!.id
  const scope1 = { tenantId: s1.tenantId, accountId }
  const profile = (await db.profiles.list())[0]!
  const live = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440020', name: 'Live', profileId: profile.id, accountId })
  liveId = live.id.toString()
  const old = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440021', name: 'Old', profileId: profile.id, accountId })
  retiredId = old.id.toString()
  await db.devices.retire(scope1, { userId: s1.userId }, retiredId)
  // backdate the retire past the erase safety window (review HIGH-1) — freshly-retired 409 is tested separately
  await pool.query(`UPDATE devices SET "retiredAt" = now() - interval '2 hours' WHERE id = $1`, [retiredId])
  const fresh = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440022', name: 'Fresh', profileId: profile.id, accountId })
  freshRetiredId = fresh.id.toString()
  await db.devices.retire(scope1, { userId: s1.userId }, freshRetiredId)

  t1Token = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })
  viewerToken = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000cc', tenantId: s1.tenantId, accountId, role: 'viewer' })
  managerToken = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000cd', tenantId: s1.tenantId, accountId, role: 'account_manager' })

  const gdpr = {
    enqueueErase: (d: { deviceId: string; tenantId: string }) => { erased.push(d); return Promise.resolve() },
    enqueueExport: (d: { exportId: string }) => { exported.push(d); return Promise.resolve() },
    eraseMinRetiredMs: 60 * 60_000, // real default — the seeded device is backdated past it
  }
  const app = createApp({ redis, redisSub: redis, db, pool, gdpr, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('E08-4 GDPR API', () => {
  it('erase: a LIVE device is refused (400 — retire first, so ingest is already torn down)', async () => {
    expect((await req(`/v1/devices/${liveId}/erase`, t1Token, 'POST')).status).toBe(400)
    expect(erased).toHaveLength(0)
  })

  it('erase: a retired device is queued (202) with an audit row', async () => {
    const res = await req(`/v1/devices/${retiredId}/erase`, t1Token, 'POST')
    expect(res.status).toBe(202)
    expect(erased).toHaveLength(1)
    expect(erased[0]!.deviceId).toBe(retiredId)
    const audit = await db.audit.list({ tenantId: erased[0]!.tenantId }, { entity: 'device', action: 'delete' })
    expect(audit.some((a) => a.entityId === retiredId)).toBe(true)
  })

  it('erase: cross-tenant → 404, viewer AND account_manager → 403 (irreversible destruction = tenant admins)', async () => {
    expect((await req(`/v1/devices/${retiredId}/erase`, t2Token, 'POST')).status).toBe(404)
    expect((await req(`/v1/devices/${retiredId}/erase`, viewerToken, 'POST')).status).toBe(403)
    expect((await req(`/v1/devices/${retiredId}/erase`, managerToken, 'POST')).status).toBe(403)
  })

  it('erase: a FRESHLY retired device is refused (409) until the resurrection window passes', async () => {
    const res = await req(`/v1/devices/${freshRetiredId}/erase`, t1Token, 'POST')
    expect(res.status).toBe(409)
    expect(erased.some((e) => e.deviceId === freshRetiredId)).toBe(false)
  })

  it('export download past expiry → 410 Gone', async () => {
    const job = (await (await req(`/v1/accounts/${accountId}/export`, t1Token, 'POST')).json()) as { id: string }
    await pool.query(`UPDATE export_jobs SET status='done', path='/nonexistent/file.gz', "expiresAt" = now() - interval '1 day' WHERE id=$1`, [job.id])
    expect((await req(`/v1/exports/${job.id}/download`, t1Token)).status).toBe(410)
  })

  it('export: POST creates a pending job (201) and enqueues it; status is readable scoped', async () => {
    const res = await req(`/v1/accounts/${accountId}/export`, t1Token, 'POST')
    expect(res.status).toBe(201)
    const job = (await res.json()) as { id: string; status: string; accountId: string }
    expect(job.status).toBe('pending')
    expect(exported[exported.length - 1]).toEqual({ exportId: job.id })
    expect((await req(`/v1/exports/${job.id}`, t1Token)).status).toBe(200)
    // cross-tenant cannot see the job; viewer cannot read exports at all
    expect((await req(`/v1/exports/${job.id}`, t2Token)).status).toBe(404)
    expect((await req(`/v1/exports/${job.id}`, viewerToken)).status).toBe(403)
  })

  it('export: download before the worker finished → 404 (path unset)', async () => {
    const job = (await (await req(`/v1/accounts/${accountId}/export`, t1Token, 'POST')).json()) as { id: string }
    expect((await req(`/v1/exports/${job.id}/download`, t1Token)).status).toBe(404)
  })

  it('export: cross-tenant account → 404; viewer request → 403', async () => {
    expect((await req(`/v1/accounts/${accountId}/export`, t2Token, 'POST')).status).toBe(404)
    expect((await req(`/v1/accounts/${accountId}/export`, viewerToken, 'POST')).status).toBe(403)
  })

  it('export: a second POST while one is pending COALESCES (200, same job) and re-enqueues (self-heal)', async () => {
    const before = exported.length
    const r1 = await req(`/v1/accounts/${accountId}/export`, t1Token, 'POST')
    const j1 = (await r1.json()) as { id: string }
    const r2 = await req(`/v1/accounts/${accountId}/export`, t1Token, 'POST')
    expect(r2.status).toBe(200) // coalesced, not a new job
    const j2 = (await r2.json()) as { id: string }
    expect(j2.id).toBe(j1.id)
    // self-heal: the coalesced POST re-enqueued the SAME exportId (BullMQ dedupes if alive)
    expect(exported.slice(before).map((e) => e.exportId)).toEqual([j1.id, j1.id])
  })
})
