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
let acct1: string // Fleet A
let acct2: string // Fleet B (same tenant, sibling account)
let t1Admin: string // tenant-wide tsp_admin
let amA1: string // account_manager pinned to acct1
let t2Admin: string // a different tenant

const base = () => `http://127.0.0.1:${port}`
const req = (path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base()}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}) })

/** Simulate a worker-written delivery row (the API is read-only over this table). */
async function seedDelivery(webhookId: string, accountId: string | null, eventId: string, kind = 'panic'): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_deliveries ("tenantId","accountId","webhookId","eventId",kind,"statusCode",success,error)
     VALUES ($1,$2,$3,$4,$5,200,true,NULL)`,
    [t1, accountId, webhookId, eventId, kind],
  )
}

const SECRET = 'a'.repeat(48) // ≥16 chars — the client-generated HMAC signing secret

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
  // tenant W1 with account "Fleet A"; add a sibling account "Fleet B"; a manager pinned to Fleet A
  const s1 = await seedUser({ databaseUrl, email: 'a@w1.test', password: 'password12', role: 'tsp_admin', tenantName: 'W1', accountName: 'Fleet A' })
  t1 = s1.tenantId
  acct1 = (await db.accounts.list({ tenantId: t1 }))[0]!.id
  acct2 = (await db.accounts.create({ tenantId: t1 }, { userId: s1.userId }, { name: 'Fleet B' })).id
  const sam = await seedUser({ databaseUrl, email: 'am@w1.test', password: 'password12', role: 'account_manager', tenantName: 'W1', accountName: 'Fleet A' })
  const s2 = await seedUser({ databaseUrl, email: 'a@w2.test', password: 'password12', role: 'tsp_admin', tenantName: 'W2' })
  t1Admin = await mintTestToken({ userId: s1.userId, tenantId: t1, role: 'tsp_admin' })
  amA1 = await mintTestToken({ userId: sam.userId, tenantId: t1, accountId: acct1, role: 'account_manager' })
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

describe('E06-4 webhooks CRUD', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await fetch(`${base()}/v1/webhooks`)).status).toBe(401)
  })

  it('a tenant admin creates a webhook; secret is never returned on read', async () => {
    const created = (await (await req('/v1/webhooks', t1Admin, 'POST', { accountId: acct1, url: 'https://hooks.example.com/a', secret: SECRET, events: ['panic'] })).json()) as { id: string; secret?: string }
    expect(typeof created.id).toBe('string')
    const got = (await (await req(`/v1/webhooks/${created.id}`, t1Admin)).json()) as { id: string; url: string; secret?: string }
    expect(got.url).toBe('https://hooks.example.com/a')
    // rule 12: the signing secret is masked on reads (readRedact → '***'), never the real value
    expect(got.secret).toBe('***')
    expect(got.secret).not.toBe(SECRET)
    const list = (await (await req('/v1/webhooks', t1Admin)).json()) as { id: string; secret?: string }[]
    expect(list.every((w) => w.secret !== SECRET)).toBe(true)
  })

  it('an account_manager can READ webhooks but CANNOT create one (WRITE = tenant admins)', async () => {
    expect((await req('/v1/webhooks', amA1)).status).toBe(200)
    expect((await req('/v1/webhooks', amA1, 'POST', { accountId: acct1, url: 'https://hooks.example.com/nope', secret: SECRET })).status).toBe(403)
  })

  it('a too-short secret (<16) is a 400 at the schema', async () => {
    expect((await req('/v1/webhooks', t1Admin, 'POST', { accountId: acct1, url: 'https://hooks.example.com/x', secret: 'short' })).status).toBe(400)
  })

  it('toggle enabled off via PATCH, then delete → 404 on re-fetch', async () => {
    const wh = (await (await req('/v1/webhooks', t1Admin, 'POST', { accountId: acct1, url: 'https://hooks.example.com/toggle', secret: SECRET })).json()) as { id: string }
    expect((await (await req(`/v1/webhooks/${wh.id}`, t1Admin, 'PATCH', { enabled: false })).json() as { enabled: boolean }).enabled).toBe(false)
    expect((await req(`/v1/webhooks/${wh.id}`, t1Admin, 'DELETE')).status).toBe(200)
    expect((await req(`/v1/webhooks/${wh.id}`, t1Admin)).status).toBe(404)
  })

  it('cross-tenant: W2 cannot see or fetch a W1 webhook', async () => {
    const mine = (await (await req('/v1/webhooks', t1Admin, 'POST', { accountId: acct1, url: 'https://hooks.example.com/t1', secret: SECRET })).json()) as { id: string }
    expect((await req(`/v1/webhooks/${mine.id}`, t2Admin)).status).toBe(404)
    const list = (await (await req('/v1/webhooks', t2Admin)).json()) as { id: string }[]
    expect(list.map((w) => w.id)).not.toContain(mine.id)
  })
})

describe('E06-4b webhook deliveries — cross-account isolation (audit A1)', () => {
  it('an account_manager sees only its account + tenant-shared deliveries, never a sibling account', async () => {
    // three webhooks: one per account + one tenant-shared (null account)
    const whA1 = (await (await req('/v1/webhooks', t1Admin, 'POST', { accountId: acct1, url: 'https://hooks.example.com/d-a1', secret: SECRET })).json()) as { id: string }
    const whA2 = (await (await req('/v1/webhooks', t1Admin, 'POST', { accountId: acct2, url: 'https://hooks.example.com/d-a2', secret: SECRET })).json()) as { id: string }
    const whShared = (await (await req('/v1/webhooks', t1Admin, 'POST', { accountId: null, url: 'https://hooks.example.com/d-shared', secret: SECRET })).json()) as { id: string }
    await seedDelivery(whA1.id, acct1, 'evt-a1')
    await seedDelivery(whA2.id, acct2, 'evt-a2')
    await seedDelivery(whShared.id, null, 'evt-shared')

    // tenant-wide admin sees every delivery in the tenant (all three)
    const adminEvents = new Set(((await (await req('/v1/webhook-deliveries', t1Admin)).json()) as { eventId: string }[]).map((d) => d.eventId))
    expect(adminEvents).toEqual(new Set(['evt-a1', 'evt-a2', 'evt-shared']))

    // the manager pinned to Fleet A: sees its own + the tenant-shared row, but NEVER Fleet B's.
    // This is the exact leak the scopedWhere account fix (repos/webhookDeliveries.ts) closes.
    const mgrEvents = new Set(((await (await req('/v1/webhook-deliveries', amA1)).json()) as { eventId: string }[]).map((d) => d.eventId))
    expect(mgrEvents.has('evt-a1')).toBe(true)
    expect(mgrEvents.has('evt-shared')).toBe(true)
    expect(mgrEvents.has('evt-a2')).toBe(false) // sibling account — must be invisible
  })

  it('cross-tenant: W2 sees none of W1 deliveries', async () => {
    const t2Events = (await (await req('/v1/webhook-deliveries', t2Admin)).json()) as { eventId: string }[]
    expect(t2Events.every((d) => !d.eventId.startsWith('evt-'))).toBe(true)
  })

  it('the webhookId filter narrows the log to one webhook', async () => {
    const wh = (await (await req('/v1/webhooks', t1Admin, 'POST', { accountId: acct1, url: 'https://hooks.example.com/filter', secret: SECRET })).json()) as { id: string }
    await seedDelivery(wh.id, acct1, 'evt-filter')
    const rows = (await (await req(`/v1/webhook-deliveries?webhookId=${wh.id}`, t1Admin)).json()) as { webhookId: string; eventId: string }[]
    expect(rows.length).toBe(1)
    expect(rows[0]!.eventId).toBe('evt-filter')
  })

  it('a garbage cursor / webhookId does not 500 (repo sanitizes)', async () => {
    expect((await req('/v1/webhook-deliveries?cursor=notanumber&webhookId=notauuid', t1Admin)).status).toBe(200)
  })
})
