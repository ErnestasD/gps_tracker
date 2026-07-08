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

let t1Token: string
let t2Token: string
let devId: string // t1's device (BigInt as string)

const base = () => `http://127.0.0.1:${port}`
const get = (path: string, token: string) => fetch(`${base()}${path}`, { headers: { authorization: `Bearer ${token}` } })
const T0 = new Date('2026-07-01T06:00:00Z')

beforeAll(async () => {
  ;[pg, redisC] = await Promise.all([
    new GenericContainer(PG_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'orbetra' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .withStartupTimeout(240_000)
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/)).start(),
  ])
  const databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  execFileSync('pnpm', ['exec', 'tsx', 'sql/migrate.ts'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), { maxRetriesPerRequest: null })
  db = createDb(databaseUrl)
  pool = createPool(databaseUrl)

  const s1 = await seedUser({ databaseUrl, email: 'a@h1.test', password: 'password12', role: 'tsp_admin', tenantName: 'H1', accountName: 'Fleet' })
  const s2 = await seedUser({ databaseUrl, email: 'a@h2.test', password: 'password12', role: 'tsp_admin', tenantName: 'H2' })
  t1Token = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })

  // a device in T1 + a profile (device create needs a profile FK)
  const acct = (await db.accounts.list({ tenantId: s1.tenantId }))[0]!
  const [prof] = await pool.query<{ id: string }>(`INSERT INTO device_profiles(id,key,name) VALUES (gen_random_uuid(),'hk','P') RETURNING id`).then((r) => r.rows)
  const dev = await db.devices.create({ tenantId: s1.tenantId, accountId: acct.id }, { userId: s1.userId }, { accountId: acct.id, profileId: prof!.id, imei: '356307042449001', name: 'Truck' })
  devId = dev.id.toString()

  // 5 positions over 40 s (one invalid fix), + a trip
  let h = 0
  for (const [sec, valid, speed] of [[0, true, 10], [10, true, 20], [20, false, 0], [30, true, 30], [40, true, 15]] as const) {
    await pool.query(
      `INSERT INTO positions (device_id, fix_time, server_time, lat, lon, speed, fix_valid, rec_hash)
       VALUES ($1,$2,$2,$3,25.0,$4,$5,$6)`,
      [devId, new Date(T0.getTime() + sec * 1000), 54.0 + sec * 0.0001, speed, valid, ++h],
    )
  }
  await pool.query(`INSERT INTO trips ("tenantId","accountId","deviceId","status","startTime","endTime","distanceM") VALUES ($1,$2,$3,'closed',$4,$5,1234)`, [s1.tenantId, acct.id, devId, T0, new Date(T0.getTime() + 40_000)])

  const app = createApp({
    redis, redisSub: redis, db, pool,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1',
  })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end()
  await db.$disconnect()
  await redis.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

describe('E04-3 positions history', () => {
  it('returns the device positions chronologically, including the invalid fix (trail gap)', async () => {
    const rows = (await (await get(`/v1/devices/${devId}/positions`, t1Token)).json()) as { fixTime: string; fixValid: boolean }[]
    expect(rows).toHaveLength(5)
    const times = rows.map((r) => r.fixTime)
    expect([...times].sort()).toEqual(times) // ascending
    expect(rows.filter((r) => !r.fixValid)).toHaveLength(1) // I5 gap preserved for playback
  })

  it('from/to narrows the window; limit + cursor paginate', async () => {
    const mid = new Date(T0.getTime() + 15_000).toISOString()
    const after = (await (await get(`/v1/devices/${devId}/positions?from=${mid}`, t1Token)).json()) as unknown[]
    expect(after).toHaveLength(3) // sec 20,30,40
    const page1 = (await (await get(`/v1/devices/${devId}/positions?limit=2`, t1Token)).json()) as { fixTime: string; recHash: string }[]
    expect(page1).toHaveLength(2)
    const cursor = `${Date.parse(page1[1]!.fixTime)}_${page1[1]!.recHash}`
    const page2 = (await (await get(`/v1/devices/${devId}/positions?limit=2&cursor=${cursor}`, t1Token)).json()) as unknown[]
    expect(page2).toHaveLength(2)
    // no overlap between pages
    expect((page2[0] as { fixTime: string }).fixTime > page1[1]!.fixTime).toBe(true)
  })

  it('garbage from/to/cursor/limit never 500 — incl. numeric overflow (review MED-1)', async () => {
    for (const qs of [
      'from=garbage', 'to=nonsense', 'cursor=not-a-cursor', 'cursor=abc_def', 'limit=NaN', 'limit=-5', 'limit=99999999',
      'cursor=99999999999999999999_1', // ms overflows a pg timestamp
      'cursor=1000000000000_99999999999999999999999999', // rec_hash overflows int8
      'from=-271821-04-20T00:00:00.000Z', // JS-valid, below pg timestamp min
    ]) {
      const res = await get(`/v1/devices/${devId}/positions?${qs}`, t1Token)
      expect(res.status, qs).toBe(200)
      expect(Array.isArray(await res.json())).toBe(true)
    }
  })

  it('an oversize numeric device/trip :id → 404, not a 500 (review MED-2)', async () => {
    const huge = '99999999999999999999999999'
    expect((await get(`/v1/devices/${huge}/positions`, t1Token)).status).toBe(404)
    expect((await get(`/v1/devices/${huge}/trips`, t1Token)).status).toBe(404)
    expect((await get(`/v1/trips/${huge}`, t1Token)).status).toBe(404)
  })

  it('cross-tenant device → 404 (scope gate before any positions read)', async () => {
    expect((await get(`/v1/devices/${devId}/positions`, t2Token)).status).toBe(404)
    expect((await get(`/v1/devices/${devId}/trips`, t2Token)).status).toBe(404)
  })
})

describe('E04-3 trips read', () => {
  it('lists a device’s trips (scoped) and filters cross-tenant out', async () => {
    const mine = (await (await get(`/v1/devices/${devId}/trips`, t1Token)).json()) as { deviceId: string; distanceM: number }[]
    expect(mine).toHaveLength(1)
    expect(mine[0]!.distanceM).toBe(1234)
    // T2 listing its own (empty) trips never sees T1's
    const t2 = (await (await get(`/v1/trips`, t2Token)).json()) as unknown[]
    expect(t2).toHaveLength(0)
  })
})
