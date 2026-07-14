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
 * V2 maintenance — the API-level due behaviour the review flagged: a km reminder created with NO
 * explicit baseline must start from the device's CURRENT odometer (a full interval remaining), NOT
 * be baselined at 0 (which would read "overdue" the instant it's created on a used vehicle).
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
let token: string
let devId: string

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, method = 'GET', body?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE).withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' }).withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2)).withStartupTimeout(240_000).start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  const databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  execFileSync('pnpm', ['exec', 'tsx', 'sql/migrate.ts'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  db = createDb(databaseUrl)
  pool = createPool(databaseUrl)

  const s = await seedUser({ databaseUrl, email: 'a@m.test', password: 'password12', role: 'tsp_admin', tenantName: 'M', accountName: 'Fleet' })
  token = await mintTestToken({ userId: s.userId, tenantId: s.tenantId, role: 'tsp_admin' })
  const acct = (await db.accounts.list({ tenantId: s.tenantId }))[0]!
  const [prof] = await pool.query<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'mk','P') RETURNING id`).then((r) => r.rows)
  const dev = await db.devices.create({ tenantId: s.tenantId, accountId: acct.id }, { userId: s.userId }, { accountId: acct.id, profileId: prof!.id, imei: '356307042470001', name: 'Van' })
  devId = dev.id.toString()
  // the van already reads 250 000 km (odometer_m)
  await pool.query(`INSERT INTO positions (device_id, fix_time, lat, lon, fix_valid, rec_hash, odometer_m) VALUES ($1, now(), 54.7, 25.3, true, 1, 250000000)`, [devId])

  const app = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

describe('V2 maintenance API', () => {
  it('a km reminder with no baseline starts from the current odometer (not overdue at creation)', async () => {
    const res = await req('/v1/maintenance', 'POST', { deviceId: devId, title: 'Oil change', intervalKm: 15000 })
    expect(res.status).toBe(201)
    const view = (await res.json()) as { currentOdoKm: number; lastServiceOdoKm: number; due: { status: string; kmRemaining: number } }
    expect(view.currentOdoKm).toBe(250000) // 250000000 m → 250000 km
    expect(view.lastServiceOdoKm).toBe(250000) // baselined to current, NOT 0
    expect(view.due.kmRemaining).toBe(15000) // a full interval remaining
    expect(view.due.status).toBe('ok') // NOT 'overdue'
  })

  it('GET returns the computed due; oversize numeric deviceId filter → 200 (not 500)', async () => {
    expect((await req('/v1/maintenance')).status).toBe(200)
    // 19 nines exceeds int8 — must be range-guarded, not a 500
    expect((await req('/v1/maintenance?deviceId=9999999999999999999')).status).toBe(200)
    // cross-scope device on create → 400 (never 500), non-numeric deviceId too
    expect((await req('/v1/maintenance', 'POST', { deviceId: 'not-a-number', title: 'x', intervalDays: 30 })).status).toBe(400)
  })

  it('mark-serviced resets the baseline and the response carries a fresh due', async () => {
    const created = (await (await req('/v1/maintenance', 'POST', { deviceId: devId, title: 'Tyres', intervalKm: 10000 })).json()) as { id: string }
    const res = await req(`/v1/maintenance/${created.id}/serviced`, 'POST', { odoKm: 250000 })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { lastServiceOdoKm: number; due: { status: string } }
    expect(view.lastServiceOdoKm).toBe(250000)
    expect(view.due.status).toBe('ok')
  })
})
