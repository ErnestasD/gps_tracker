import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'

import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * Affiliate management API (item 5 / W9 phase 3), PLATFORM level. Proves the platform_admin CRUD +
 * commission-review handlers over a real DB: auto-generated code, 409 on a duplicate code/email,
 * 404 on a missing id, and the tenant-admin RBAC gate (a non-platform_admin never reaches these).
 * The full cross-tenant 403 sweep is the isolation suite's job — here we assert the handler shapes.
 */
const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let redisSub: Redis
let db: Db
let databaseUrl: string
let port: number
let httpServer: ReturnType<typeof createServer>

let platformToken: string
let tenantToken: string

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base()}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}),
  })

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
  databaseUrl = `postgresql://postgres:test@${pg.getHost()}:${pg.getMappedPort(5432)}/orbetra`
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: DB_PKG, env: { ...process.env, DATABASE_URL: databaseUrl } })
  const opts = { maxRetriesPerRequest: null }
  redis = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  redisSub = new Redis(redisC.getMappedPort(6379), redisC.getHost(), opts)
  db = createDb(databaseUrl)

  const seeded = await seedUser({ databaseUrl, email: 'pa@x.test', password: 'password12', role: 'platform_admin', tenantName: 'PlatCo', accountName: 'Fleet' })
  platformToken = await mintTestToken({ userId: seeded.userId, tenantId: seeded.tenantId, role: 'platform_admin' })
  tenantToken = await mintTestToken({ userId: seeded.userId, tenantId: seeded.tenantId, role: 'tsp_admin' })

  const app = createApp({
    redis, redisSub, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30,
    lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
  })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await db.$disconnect()
  await redis.quit()
  await redisSub.quit()
  await Promise.all([pg.stop(), redisC.stop()])
})

describe('affiliate management API (platform)', () => {
  it('a tenant admin (non-platform_admin) is refused every affiliate route (403)', async () => {
    expect((await req('/v1/affiliates', tenantToken)).status).toBe(403)
    expect((await req('/v1/affiliates', tenantToken, 'POST', { name: 'X', email: 'x@x.co' })).status).toBe(403)
  })

  it('creates a partner with an auto-generated code + default commission terms', async () => {
    const res = await req('/v1/affiliates', platformToken, 'POST', { name: 'Acme Partners', email: 'acme@partner.co' })
    expect(res.status).toBe(201)
    const a = (await res.json()) as { id: string; code: string; status: string; commissionPct: string; commissionMonths: number }
    expect(a.status).toBe('pending')
    expect(a.code).toMatch(/^[A-Z2-9]{8}$/) // no ambiguous glyphs
    expect(Number(a.commissionPct)).toBe(20)
    expect(a.commissionMonths).toBe(12)
    // it now appears in the list
    const list = (await (await req('/v1/affiliates', platformToken)).json()) as { id: string }[]
    expect(list.some((x) => x.id === a.id)).toBe(true)
  })

  it('honours a custom code + terms, and 409s a duplicate code or email', async () => {
    const first = await req('/v1/affiliates', platformToken, 'POST', { name: 'Beta', email: 'beta@partner.co', code: 'BETA-1', commissionPct: 25, commissionMonths: 6 })
    expect(first.status).toBe(201)
    const b = (await first.json()) as { commissionPct: string; commissionMonths: number }
    expect(Number(b.commissionPct)).toBe(25)
    expect(b.commissionMonths).toBe(6)
    // duplicate code
    expect((await req('/v1/affiliates', platformToken, 'POST', { name: 'Dup', email: 'other@partner.co', code: 'BETA-1' })).status).toBe(409)
    // duplicate email
    expect((await req('/v1/affiliates', platformToken, 'POST', { name: 'Dup2', email: 'beta@partner.co', code: 'OTHER-1' })).status).toBe(409)
  })

  it('activates a partner (status change) and 404s an unknown id', async () => {
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Gamma', email: 'gamma@partner.co' })).json()) as { id: string }
    const patched = await req(`/v1/affiliates/${a.id}`, platformToken, 'PATCH', { status: 'active' })
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { status: string }).status).toBe('active')
    expect((await req('/v1/affiliates/00000000-0000-0000-0000-0000000000ff', platformToken, 'PATCH', { status: 'active' })).status).toBe(404)
  })

  it('lists an affiliate commissions (empty for a fresh partner)', async () => {
    const a = (await (await req('/v1/affiliates', platformToken, 'POST', { name: 'Delta', email: 'delta@partner.co' })).json()) as { id: string }
    const res = await req(`/v1/affiliates/${a.id}/commissions`, platformToken)
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown[]).toEqual([])
  })

  it('404s marking an unknown commission paid', async () => {
    expect((await req('/v1/commissions/00000000-0000-0000-0000-0000000000ff', platformToken, 'PATCH', { status: 'paid' })).status).toBe(404)
  })
})
