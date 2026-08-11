import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createDb, type Db } from '@orbetra/db'

import { seedProfiles } from '../../../packages/db/seed/profiles.js'
import { seedUser } from '../../../packages/db/seed/users.js'
import { createApp } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

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

let tenantId: string
let accountId: string
let profileId: string
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
  tenantId = seeded.tenantId
  accountId = (await db.accounts.list({ tenantId }))[0]!.id
  profileId = (await seedProfiles(databaseUrl))['fmb1xx']!
  platformToken = await mintTestToken({ userId: seeded.userId, tenantId, role: 'platform_admin' })
  tenantToken = await mintTestToken({ userId: seeded.userId, tenantId, role: 'tsp_admin' })

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

beforeEach(async () => {
  await redis.flushall()
})

/** Simulate ingest quarantining an unknown IMEI. */
async function quarantine(imei: string, nowMs: number, rejects: number): Promise<void> {
  await redis.zadd('quarantine:imei', nowMs, imei)
  await redis.set(`quarantine:rejects:${imei}`, String(rejects))
}

describe('E03-4 quarantine list', () => {
  it('AC[2]: non-platform_admin → 403', async () => {
    expect((await req('/v1/quarantine', tenantToken)).status).toBe(403)
  })

  it('platform_admin sees the list newest-first with reject counts + last-seen', async () => {
    await quarantine('356307042449001', 1000, 2)
    await quarantine('356307042449002', 2000, 5)
    const res = await req('/v1/quarantine', platformToken)
    expect(res.status).toBe(200)
    const list = (await res.json()) as { imei: string; lastSeenMs: number; rejects: number }[]
    expect(list.map((e) => e.imei)).toEqual(['356307042449002', '356307042449001']) // newest first
    expect(list[0]).toMatchObject({ lastSeenMs: 2000, rejects: 5 })
  })

  it('empty quarantine → empty list', async () => {
    expect((await (await req('/v1/quarantine', platformToken)).json()) as unknown[]).toEqual([])
  })
})

describe('E03-4 claim', () => {
  it('AC[1] mechanism: claim creates the device in the TARGET tenant, activates registry, removes from quarantine', async () => {
    const imei = '356307042449100'
    await quarantine(imei, 1000, 3)
    const res = await req(`/v1/quarantine/${imei}/claim`, platformToken, 'POST', { tenantId, accountId, profileId, name: 'Claimed' })
    expect(res.status).toBe(201)
    const { deviceId } = (await res.json()) as { deviceId: string }
    // registry populated → ingest would accept
    expect(await redis.hget('registry:imei', imei)).toBe(deviceId)
    expect(await redis.hget('device:tenant', deviceId)).toBe(tenantId)
    // gone from quarantine
    expect(await redis.zscore('quarantine:imei', imei)).toBeNull()
    expect(await redis.get(`quarantine:rejects:${imei}`)).toBeNull()
    // and it's a real scoped device
    const device = await db.devices.getByImei({ tenantId }, imei)
    expect(device?.name).toBe('Claimed')
  })

  it('claim validates the account belongs to the target tenant → 400', async () => {
    const other = await seedUser({ databaseUrl, email: 'o@x.test', password: 'password12', role: 'tsp_admin', tenantName: 'OtherCo', accountName: 'OF' })
    const otherAccount = (await db.accounts.list({ tenantId: other.tenantId }))[0]!.id
    // claim into `tenantId` but with OTHER tenant's account → rejected
    const res = await req('/v1/quarantine/356307042449200/claim', platformToken, 'POST', { tenantId, accountId: otherAccount, profileId, name: 'X' })
    expect(res.status).toBe(400)
  })

  it('claiming an already-registered IMEI → 409', async () => {
    const imei = '356307042449300'
    await req(`/v1/quarantine/${imei}/claim`, platformToken, 'POST', { tenantId, accountId, profileId, name: 'First' })
    const dup = await req(`/v1/quarantine/${imei}/claim`, platformToken, 'POST', { tenantId, accountId, profileId, name: 'Second' })
    expect(dup.status).toBe(409)
  })

  it('AUDIT #2: a claim releases a RETIRED holder in ANOTHER tenant — the remedy for an IMEI squat', async () => {
    // Retiring frees the plan slot (countActive filters retiredAt) but used to keep the IMEI blocked
    // against every other tenant forever, so create->retire in a loop squatted IMEIs for free from a
    // trial account — and nothing could release one: deleting the squatting tenant fails on a
    // RESTRICT foreign key. A customer whose own hardware was squatted had to wait for manual SQL.
    const imei = '356307042449600'
    const squatter = await seedUser({ databaseUrl, email: 'squat@x.test', password: 'password12', role: 'tsp_admin', tenantName: 'Squatter Ltd', accountName: 'SF' })
    const squatterAccount = (await db.accounts.list({ tenantId: squatter.tenantId }))[0]!.id
    const parked = await db.devices.create({ tenantId: squatter.tenantId }, { userId: squatter.userId }, { accountId: squatterAccount, profileId, imei, name: 'parked' })
    await db.devices.retire({ tenantId: squatter.tenantId }, { userId: squatter.userId }, String(parked.id))

    // quarantine membership is the PRECONDITION for the override — not evidence of anything. Anyone
    // with a socket can create an entry (the IMEI is the only identity on the ingest path), and a
    // tracker retired but never uninstalled lands here exactly like a squatted one. All it buys is
    // that the override cannot be aimed at a hold at rest.
    await quarantine(imei, 2000, 7)
    const res = await req(`/v1/quarantine/${imei}/claim`, platformToken, 'POST', { tenantId, accountId, profileId, name: 'Reclaimed' })
    expect(res.status).toBe(201)
    expect(await redis.hget('device:tenant', ((await res.json()) as { deviceId: string }).deviceId)).toBe(tenantId)

    // the LOSING tenant gets a record too — a transfer nobody can see is how a support dispute
    // becomes unresolvable
    const trail = await db.audit.list({ tenantId: squatter.tenantId }, {})
    expect(trail.some((e) => JSON.stringify(e.after ?? {}).includes('released'))).toBe(true)
  })

  it('AUDIT #2: a claim NEVER releases an ACTIVE holder, platform_admin or not', async () => {
    // The reason the hold exists at all: an active holder means the tracker is in service in another
    // account and its positions are being delivered there. Handing the IMEI over would point another
    // company's vehicle into a stranger's map — a data leak, not an onboarding inconvenience.
    //
    // This one is a regression guard for `devices_imei_active_key`, NOT a test of the override: it
    // passes with this whole change reverted, because a global partial unique index makes two live
    // rows on one IMEI impossible whatever the application does. Kept because the behaviour is
    // worth locking; labelled because a test that looks like it proves the new code and does not is
    // how a guarantee quietly disappears.
    const imei = '356307042449700'
    const owner = await seedUser({ databaseUrl, email: 'owner@x.test', password: 'password12', role: 'tsp_admin', tenantName: 'Owner Co', accountName: 'OC' })
    const ownerAccount = (await db.accounts.list({ tenantId: owner.tenantId }))[0]!.id
    await db.devices.create({ tenantId: owner.tenantId }, { userId: owner.userId }, { accountId: ownerAccount, profileId, imei, name: 'in service' })
    await quarantine(imei, 3000, 2)
    expect((await req(`/v1/quarantine/${imei}/claim`, platformToken, 'POST', { tenantId, accountId, profileId, name: 'Steal' })).status).toBe(409)
  })

  it('claim of an IMEI not in quarantine still creates the device (zset is a hint)', async () => {
    const res = await req('/v1/quarantine/356307042449400/claim', platformToken, 'POST', { tenantId, accountId, profileId, name: 'Fresh' })
    expect(res.status).toBe(201)
  })

  it('non-platform_admin cannot claim → 403', async () => {
    expect((await req('/v1/quarantine/356307042449500/claim', tenantToken, 'POST', { tenantId, accountId, profileId, name: 'X' })).status).toBe(403)
  })

  it('bad IMEI in path → 400', async () => {
    expect((await req('/v1/quarantine/not-an-imei/claim', platformToken, 'POST', { tenantId, accountId, profileId, name: 'X' })).status).toBe(400)
  })

  it('unknown (well-formed) profileId → 400, NOT a 500 FK violation (review MED)', async () => {
    const res = await req('/v1/quarantine/356307042449600/claim', platformToken, 'POST', {
      tenantId, accountId, profileId: '00000000-0000-0000-0000-000000000000', name: 'X',
    })
    expect(res.status).toBe(400)
  })
})

describe('E03-4 tenant accounts (platform, for the claim dialog)', () => {
  it('platform_admin lists a specific tenant’s accounts; tenant admin → 403', async () => {
    const res = await req(`/v1/tenants/${tenantId}/accounts`, platformToken)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { id: string }[]).some((a) => a.id === accountId)).toBe(true)
    expect((await req(`/v1/tenants/${tenantId}/accounts`, tenantToken)).status).toBe(403)
  })
})
