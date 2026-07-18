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

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let db: Db
let pool: Pool
let port: number
let httpServer: ReturnType<typeof createServer>
let t1: string
let acct1: string
let t1Admin: string // tenant-wide tsp_admin
let amA1: string // account_manager pinned to acct1 (ACCOUNT_WRITERS → may manage reports)
let viewerA1: string // account-scoped viewer — read only
let t2Admin: string // a different tenant

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}) })

const daily = { reportType: 'trips', cadence: 'daily', hourUtc: 6, recipients: ['ops@fleet.test'] } as const

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
  const s1 = await seedUser({ databaseUrl, email: 'a@sr1.test', password: 'password12', role: 'tsp_admin', tenantName: 'SR1', accountName: 'Fleet' })
  const sam = await seedUser({ databaseUrl, email: 'am@sr1.test', password: 'password12', role: 'account_manager', tenantName: 'SR1', accountName: 'Fleet' })
  const sv = await seedUser({ databaseUrl, email: 'v@sr1.test', password: 'password12', role: 'viewer', tenantName: 'SR1', accountName: 'Fleet' })
  const s2 = await seedUser({ databaseUrl, email: 'a@sr2.test', password: 'password12', role: 'tsp_admin', tenantName: 'SR2' })
  t1 = s1.tenantId
  acct1 = (await db.accounts.list({ tenantId: t1 }))[0]!.id
  // account-local day boundaries (§7.7): the create handler defaults an omitted timezone to THIS
  await pool.query('UPDATE accounts SET timezone=$1 WHERE id=$2', ['Europe/Warsaw', acct1])
  t1Admin = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'tsp_admin' })
  amA1 = await mintTestToken({ userId: sam.userId, tenantId: t1, accountId: acct1, role: 'account_manager' })
  viewerA1 = await mintTestToken({ userId: sv.userId, tenantId: t1, accountId: acct1, role: 'viewer' })
  t2Admin = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })

  const app = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('scheduled reports API (V1-nice)', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await fetch(`${base()}/v1/scheduled-reports`)).status).toBe(401)
  })

  it('a tenant-wide caller must name an accountId (400)', async () => {
    expect((await req('/v1/scheduled-reports', t1Admin, 'POST', daily)).status).toBe(400)
  })

  it('an omitted timezone defaults to the account timezone (audit fix, §7.7)', async () => {
    const created = (await (await req('/v1/scheduled-reports', t1Admin, 'POST', { ...daily, accountId: acct1 })).json()) as { id: string; timezone: string; accountId: string }
    expect(created.timezone).toBe('Europe/Warsaw') // NOT the DB column default 'UTC'
    expect(created.accountId).toBe(acct1)
  })

  it('an explicit timezone is respected', async () => {
    const created = (await (await req('/v1/scheduled-reports', t1Admin, 'POST', { ...daily, accountId: acct1, timezone: 'Europe/Vilnius' })).json()) as { timezone: string }
    expect(created.timezone).toBe('Europe/Vilnius')
  })

  it('a weekly cadence without a weekday is a 400 (schema refine)', async () => {
    expect((await req('/v1/scheduled-reports', t1Admin, 'POST', { reportType: 'mileage', cadence: 'weekly', hourUtc: 6, recipients: ['x@y.test'], accountId: acct1 })).status).toBe(400)
  })

  it('an account_manager creates one (accountId comes from the token) and it defaults the tz too', async () => {
    const created = (await (await req('/v1/scheduled-reports', amA1, 'POST', daily)).json()) as { id: string; timezone: string; accountId: string }
    expect(created.accountId).toBe(acct1)
    expect(created.timezone).toBe('Europe/Warsaw')
  })

  it('a viewer cannot create a scheduled report (write policy = ACCOUNT_WRITERS → 403)', async () => {
    expect((await req('/v1/scheduled-reports', viewerA1, 'POST', daily)).status).toBe(403)
  })

  it('create → list → get → delete → 404 round-trip', async () => {
    const sr = (await (await req('/v1/scheduled-reports', t1Admin, 'POST', { ...daily, accountId: acct1 })).json()) as { id: string }
    const list = (await (await req('/v1/scheduled-reports', t1Admin)).json()) as { id: string }[]
    expect(list.some((r) => r.id === sr.id)).toBe(true)
    expect((await req(`/v1/scheduled-reports/${sr.id}`, t1Admin)).status).toBe(200)
    expect((await req(`/v1/scheduled-reports/${sr.id}`, t1Admin, 'DELETE')).status).toBe(200)
    expect((await req(`/v1/scheduled-reports/${sr.id}`, t1Admin)).status).toBe(404)
  })

  it('cross-tenant: SR2 cannot see, fetch, or delete an SR1 report', async () => {
    const sr = (await (await req('/v1/scheduled-reports', t1Admin, 'POST', { ...daily, accountId: acct1 })).json()) as { id: string }
    expect((await req(`/v1/scheduled-reports/${sr.id}`, t2Admin)).status).toBe(404)
    expect((await req(`/v1/scheduled-reports/${sr.id}`, t2Admin, 'DELETE')).status).toBe(404)
    const t2list = (await (await req('/v1/scheduled-reports', t2Admin)).json()) as { id: string }[]
    expect(t2list.map((r) => r.id)).not.toContain(sr.id)
  })
})
