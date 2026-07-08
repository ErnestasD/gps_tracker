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
let t2: string
let acct1: string
let t1Token: string
let t2Token: string

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}) })

// a ~1 km square near Vilnius
const square = (lon: number, lat: number, d = 0.01) => ({
  type: 'Polygon',
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
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
  const s1 = await seedUser({ databaseUrl, email: 'a@g1.test', password: 'password12', role: 'tsp_admin', tenantName: 'G1', accountName: 'Fleet' })
  const s2 = await seedUser({ databaseUrl, email: 'a@g2.test', password: 'password12', role: 'tsp_admin', tenantName: 'G2' })
  t1 = s1.tenantId
  t2 = s2.tenantId
  acct1 = (await db.accounts.list({ tenantId: t1 }))[0]!.id
  t1Token = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'tsp_admin' })
  t2Token = await mintTestToken({ userId: s2.userId, tenantId: t2, role: 'tsp_admin' })

  const app = createApp({ redis, redisSub: redis, db, pool, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('E05-1 geofence CRUD', () => {
  it('creates a polygon and reads it back as GeoJSON', async () => {
    const res = await req('/v1/geofences', t1Token, 'POST', { name: 'Depot', kind: 'polygon', color: '#00ff00', accountId: acct1, geometry: square(25.27, 54.68) })
    expect(res.status).toBe(201)
    const gf = (await res.json()) as { id: string; geometry: { type: string }; color: string }
    expect(gf.geometry.type).toBe('Polygon')
    expect(gf.color).toBe('#00ff00')
    const got = (await (await req(`/v1/geofences/${gf.id}`, t1Token)).json()) as { name: string }
    expect(got.name).toBe('Depot')
  })

  it('rejects an over-large geofence (> 10,000 km²) with 400', async () => {
    // ~5°×5° box ≈ 300k km² — well over the cap
    const res = await req('/v1/geofences', t1Token, 'POST', { name: 'Huge', kind: 'polygon', accountId: acct1, geometry: square(10, 40, 5) })
    expect(res.status).toBe(400)
  })

  it('rejects a self-intersecting (invalid) polygon with 400', async () => {
    const bowtie = { type: 'Polygon', coordinates: [[[25.0, 54.0], [25.1, 54.1], [25.1, 54.0], [25.0, 54.1], [25.0, 54.0]]] }
    const res = await req('/v1/geofences', t1Token, 'POST', { name: 'Bowtie', kind: 'polygon', accountId: acct1, geometry: bowtie })
    expect(res.status).toBe(400)
  })

  it('a malformed geometry (not a closed ring) is a 400 at the schema', async () => {
    const open = { type: 'Polygon', coordinates: [[[25.0, 54.0], [25.1, 54.0], [25.1, 54.1]]] } // 3 pts, not closed
    expect((await req('/v1/geofences', t1Token, 'POST', { name: 'x', kind: 'polygon', geometry: open })).status).toBe(400)
  })

  it('tenant-shared (accountId null) geofence is created by a tenant admin and listed', async () => {
    await req('/v1/geofences', t1Token, 'POST', { name: 'Shared', kind: 'polygon', accountId: null, geometry: square(24.0, 55.0) })
    const list = (await (await req('/v1/geofences', t1Token)).json()) as { name: string; accountId: string | null }[]
    expect(list.some((g) => g.name === 'Shared' && g.accountId === null)).toBe(true)
  })

  it('cross-tenant: T2 cannot see or fetch T1 geofences', async () => {
    const mine = (await (await req('/v1/geofences', t1Token, 'POST', { name: 'T1only', kind: 'polygon', accountId: acct1, geometry: square(23.5, 54.5) })).json()) as { id: string }
    expect((await req(`/v1/geofences/${mine.id}`, t2Token)).status).toBe(404)
    const t2list = (await (await req('/v1/geofences', t2Token)).json()) as { id: string }[]
    expect(t2list.map((g) => g.id)).not.toContain(mine.id)
  })

  it('update moves the polygon; delete removes it', async () => {
    const gf = (await (await req('/v1/geofences', t1Token, 'POST', { name: 'Edit', kind: 'polygon', accountId: acct1, geometry: square(25.0, 54.0) })).json()) as { id: string }
    expect((await req(`/v1/geofences/${gf.id}`, t1Token, 'PATCH', { geometry: square(26.0, 55.0), name: 'Edited' })).status).toBe(200)
    expect((await req(`/v1/geofences/${gf.id}`, t1Token, 'DELETE')).status).toBe(200)
    expect((await req(`/v1/geofences/${gf.id}`, t1Token)).status).toBe(404)
  })

  it('the area + validity guards also run on UPDATE (review LOW)', async () => {
    const gf = (await (await req('/v1/geofences', t1Token, 'POST', { name: 'Guard', kind: 'polygon', accountId: acct1, geometry: square(25.0, 54.0) })).json()) as { id: string }
    // PATCH to an over-large geometry → 400
    expect((await req(`/v1/geofences/${gf.id}`, t1Token, 'PATCH', { geometry: square(10, 40, 5) })).status).toBe(400)
    // PATCH to a self-intersecting geometry → 400
    const bowtie = { type: 'Polygon', coordinates: [[[25.0, 54.0], [25.1, 54.1], [25.1, 54.0], [25.0, 54.1], [25.0, 54.0]]] }
    expect((await req(`/v1/geofences/${gf.id}`, t1Token, 'PATCH', { geometry: bowtie })).status).toBe(400)
    // the original geometry is unchanged (guard rejected before write)
    expect((await req(`/v1/geofences/${gf.id}`, t1Token)).status).toBe(200)
  })

  it('a name carrying SQL is stored literally, not executed (review focus 1)', async () => {
    const evil = "Depot'); DROP TABLE geofences;--"
    const res = await req('/v1/geofences', t1Token, 'POST', { name: evil, kind: 'polygon', accountId: acct1, geometry: square(22.0, 53.0) })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { name: string }).name).toBe(evil) // stored verbatim
    // table still exists + queryable
    expect((await req('/v1/geofences', t1Token)).status).toBe(200)
  })
})
