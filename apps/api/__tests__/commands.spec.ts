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
let deviceId: string
let retiredId: string

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
  const acct1 = (await db.accounts.list({ tenantId: s1.tenantId }))[0]!.id
  const scope1 = { tenantId: s1.tenantId, accountId: acct1 }
  const profile = (await db.profiles.list())[0]!
  const dev = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440010', name: 'Truck', profileId: profile.id, accountId: acct1 })
  deviceId = dev.id.toString()
  const rdev = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440011', name: 'Old', profileId: profile.id, accountId: acct1 })
  retiredId = rdev.id.toString()
  await db.devices.retire(scope1, { userId: s1.userId }, retiredId)

  t1Token = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })
  viewerToken = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000cc', tenantId: s1.tenantId, accountId: acct1, role: 'viewer' })

  const app = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('E08-2 Codec-12 commands API', () => {
  it('queues a command → 201, and pushes it to the ingest transport queue + active set', async () => {
    const res = await req(`/v1/devices/${deviceId}/commands`, t1Token, 'POST', { text: 'getinfo' })
    expect(res.status).toBe(201)
    const cmd = (await res.json()) as { id: string; status: string; text: string }
    expect(cmd).toMatchObject({ status: 'queued', text: 'getinfo' })
    const pending = await redis.lrange(`cmd:pending:${deviceId}`, 0, -1)
    expect(pending.map((p) => JSON.parse(p) as { id: string }).some((p) => p.id === cmd.id)).toBe(true)
    expect(await redis.sismember('cmd:active', deviceId)).toBe(1)
    // and it is retrievable, scoped
    expect((await req(`/v1/commands/${cmd.id}`, t1Token)).status).toBe(200)
  })

  it('a retired device cannot be commanded (400)', async () => {
    expect((await req(`/v1/devices/${retiredId}/commands`, t1Token, 'POST', { text: 'getinfo' })).status).toBe(400)
  })

  it('isolation: another tenant cannot command the device (404), nor read its command', async () => {
    expect((await req(`/v1/devices/${deviceId}/commands`, t2Token, 'POST', { text: 'getinfo' })).status).toBe(404)
    const mine = (await (await req(`/v1/devices/${deviceId}/commands`, t1Token, 'POST', { text: 'getver' })).json()) as { id: string }
    expect((await req(`/v1/commands/${mine.id}`, t2Token)).status).toBe(404)
  })

  it('a viewer cannot send commands (403 — hardware control is a write)', async () => {
    expect((await req(`/v1/devices/${deviceId}/commands`, viewerToken, 'POST', { text: 'getinfo' })).status).toBe(403)
    // but a viewer CAN read the command list/status
    expect((await req(`/v1/devices/${deviceId}/commands`, viewerToken)).status).toBe(200)
  })

  it('rejects an empty command body (400)', async () => {
    expect((await req(`/v1/devices/${deviceId}/commands`, t1Token, 'POST', { text: '' })).status).toBe(400)
  })
})
