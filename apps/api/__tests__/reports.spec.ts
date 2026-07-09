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
let t1Token: string
let t2Token: string

const base = () => `http://127.0.0.1:${port}`
const post = (path: string, token: string | null, bodyObj: unknown) =>
  fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(bodyObj),
  })

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
  const s1 = await seedUser({ databaseUrl, email: 'a@r1.test', password: 'password12', role: 'tsp_admin', tenantName: 'R1', accountName: 'Fleet' })
  const s2 = await seedUser({ databaseUrl, email: 'a@r2.test', password: 'password12', role: 'tsp_admin', tenantName: 'R2' })
  t1 = s1.tenantId
  acct1 = (await db.accounts.list({ tenantId: t1 }))[0]!.id
  // account uses Warsaw so we can assert the local-day bucket
  await pool.query('UPDATE accounts SET timezone=$1 WHERE id=$2', ['Europe/Warsaw', acct1])
  await pool.query(
    `INSERT INTO trips ("tenantId","accountId","deviceId",status,"startTime","endTime","distanceM","distanceSource","maxSpeed","idleS")
     VALUES ($1,$2,7,'closed','2026-10-24T23:30:00Z','2026-10-25T00:10:00Z',4200,'gps',88,120)`,
    [t1, acct1],
  )
  t1Token = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })

  const app = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

const range = { from: '2026-10-24T00:00:00Z', to: '2026-10-27T00:00:00Z' }

describe('E06-1 reports API', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await post('/v1/reports/mileage', null, { ...range, accountId: acct1 })).status).toBe(401)
  })

  it('404s an unknown report type', async () => {
    expect((await post('/v1/reports/bogus', t1Token, { ...range, accountId: acct1 })).status).toBe(404)
  })

  it('a tenant-wide caller must name an accountId', async () => {
    expect((await post('/v1/reports/mileage', t1Token, range)).status).toBe(400)
  })

  it('runs a mileage report bucketed by the account timezone', async () => {
    const res = await post('/v1/reports/mileage', t1Token, { ...range, accountId: acct1 })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { type: string; rows: { day: string; deviceId: string; trips: number; distanceM: number }[] }
    expect(body.type).toBe('mileage')
    // startTime 2026-10-24T23:30Z → 01:30 Warsaw (CEST) → local day 2026-10-25
    expect(body.rows).toEqual([{ day: '2026-10-25', deviceId: '7', trips: 1, distanceM: 4200 }])
  })

  it('isolation: another tenant cannot report on account 1 (accountId not in scope → 400)', async () => {
    const res = await post('/v1/reports/mileage', t2Token, { ...range, accountId: acct1 })
    expect(res.status).toBe(400)
  })

  it('garbage dates do not 500 (repo sanitizes)', async () => {
    const res = await post('/v1/reports/mileage', t1Token, { from: 'x', to: 'y', accountId: acct1 })
    expect(res.status).toBe(200)
  })
})
