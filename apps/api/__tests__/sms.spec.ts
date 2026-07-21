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
import type { ApiDeps } from '../src/app.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * SMS gateway API (SMS gateway feature): POST /v1/devices/:id/sms enqueues a config SMS to the
 * device's SIM; GET polls delivery status. The BullMQ producer is FAKED (queue consumption is the
 * worker's spec) — this proves the HTTP contract, RBAC (ACCOUNT_WRITERS), the smsGateway plan gate,
 * scoping (cross-tenant → 404), the 503 when the platform has no SMS driver, and the 400 when the
 * device carries no SIM phone number. The `to`/`body` handed to the fake are asserted end-to-end.
 */
const PG_IMAGE = 'timescale/timescaledb-ha:pg16'
const DB_PKG = resolve(import.meta.dirname, '../../../packages/db')
const CONFIG_SMS = '  setparam 2004:orbetra.com;2005:5027;2006:0' // buildOnboarding server SMS (host:port; 2006:0 TCP)

interface SmsJob { smsDeliveryId: string; deviceId: string; tenantId: string; to: string; body: string; provider: string }

let pg: StartedTestContainer
let redisC: StartedTestContainer
let redis: Redis
let db: Db
let pool: Pool
let port: number
let portNoSms: number
let httpServer: ReturnType<typeof createServer>
let httpServerNoSms: ReturnType<typeof createServer>
let adminToken: string // tsp_admin on the tsp_grow tenant (has smsGateway)
let viewerToken: string // viewer on the same tenant/account (wrong role)
let crossToken: string // tsp_admin on a SECOND tenant (cross-tenant 404)
let directToken: string // tsp_admin on a direct_10 tenant (lacks smsGateway)
let deviceId: string // device WITH a simMsisdn
let noMsisdnId: string // device WITHOUT a simMsisdn
let directDeviceId: string
const MSISDN = '+37060000001'

const enqueued: SmsJob[] = []
const failEnqueue = { on: false }

const base = (p: number) => `http://127.0.0.1:${p}`
const req = (p: number, path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${base(p)}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : {}) })

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

  // tsp_grow tenant (smsGateway = true) with an account + two devices (one with a SIM, one without)
  const s1 = await seedUser({ databaseUrl, email: 'a@c1.test', password: 'password12', role: 'tsp_admin', tenantName: 'C1', accountName: 'Fleet' })
  const acct1 = (await db.accounts.list({ tenantId: s1.tenantId }))[0]!.id
  const scope1 = { tenantId: s1.tenantId, accountId: acct1 }
  const profile = (await db.profiles.list())[0]!
  const dev = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440010', name: 'Truck', profileId: profile.id, accountId: acct1, simMsisdn: MSISDN })
  deviceId = dev.id.toString()
  const noSim = await db.devices.create(scope1, { userId: s1.userId }, { imei: '356307042440011', name: 'NoSim', profileId: profile.id, accountId: acct1 })
  noMsisdnId = noSim.id.toString()

  // a SECOND tsp tenant (cross-tenant isolation) and a direct_10 tenant (lacks smsGateway)
  const s2 = await seedUser({ databaseUrl, email: 'a@c2.test', password: 'password12', role: 'tsp_admin', tenantName: 'C2' })
  const sd = await seedUser({ databaseUrl, email: 'a@direct.test', password: 'password12', role: 'tsp_admin', tenantName: 'Direct', accountName: 'DFleet', plan: 'direct_10' })
  const dacct = (await db.accounts.list({ tenantId: sd.tenantId }))[0]!.id
  const ddev = await db.devices.create({ tenantId: sd.tenantId, accountId: dacct }, { userId: sd.userId }, { imei: '356307042440012', name: 'DTruck', profileId: profile.id, accountId: dacct, simMsisdn: MSISDN })
  directDeviceId = ddev.id.toString()

  adminToken = await mintTestToken({ userId: s1.userId, tenantId: s1.tenantId, role: 'tsp_admin' })
  viewerToken = await mintTestToken({ userId: '00000000-0000-0000-0000-0000000000cc', tenantId: s1.tenantId, accountId: acct1, role: 'viewer' })
  crossToken = await mintTestToken({ userId: s2.userId, tenantId: s2.tenantId, role: 'tsp_admin' })
  directToken = await mintTestToken({ userId: sd.userId, tenantId: sd.tenantId, role: 'tsp_admin' })

  const sms = {
    enqueue: (job: SmsJob) => {
      if (failEnqueue.on) return Promise.reject(new Error('redis down'))
      enqueued.push(job)
      return Promise.resolve('job-id')
    },
  }
  const common: Omit<ApiDeps, 'sms'> = { redis, redisSub: redis, db, pool, onboarding: { host: 'orbetra.com', port: 5027 }, jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600, ticketTtlS: 30, lockout: { maxFails: 100, windowS: 900 }, secureCookies: false, trustProxy: false, getRemoteAddr: () => '127.0.0.1' }
  const app = createApp({ ...common, sms })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  port = await new Promise<number>((r) => httpServer.on('listening', () => r((httpServer.address() as { port: number }).port)))
  // a SECOND app with NO sms seam — proves the 503 "sms not configured" branch
  const appNoSms = createApp(common)
  httpServerNoSms = serve({ fetch: appNoSms.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  portNoSms = await new Promise<number>((r) => httpServerNoSms.on('listening', () => r((httpServerNoSms.address() as { port: number }).port)))
}, 300_000)

afterAll(async () => {
  httpServer?.closeAllConnections?.()
  httpServerNoSms?.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await new Promise<void>((r) => httpServerNoSms.close(() => r()))
  await pool.end(); await db.$disconnect(); await redis.quit(); await Promise.all([pg.stop(), redisC.stop()])
})

describe('SMS gateway API — POST /v1/devices/:id/sms', () => {
  it('201: creates a queued delivery and enqueues the config SMS (to = SIM msisdn, body = buildOnboarding server SMS)', async () => {
    const before = enqueued.length
    const res = await req(port, `/v1/devices/${deviceId}/sms`, adminToken, 'POST', {})
    expect(res.status).toBe(201)
    const delivery = (await res.json()) as { id: string; status: string; to: string; body: string; provider: string }
    expect(delivery).toMatchObject({ status: 'queued', to: MSISDN, body: CONFIG_SMS, provider: 'twilio' })
    expect(res.headers.get('cache-control')).toBe('no-store')
    // the fake seam saw exactly this delivery, with the same to/body and the delivery id as jobId key
    const job = enqueued[before]!
    expect(job).toMatchObject({ smsDeliveryId: delivery.id, deviceId, to: MSISDN, body: CONFIG_SMS, provider: 'twilio' })
    expect(typeof job.tenantId).toBe('string')
    // and GET lists it back (the UI polls this)
    const list = (await (await req(port, `/v1/devices/${deviceId}/sms`, adminToken)).json()) as { id: string }[]
    expect(list.some((d) => d.id === delivery.id)).toBe(true)
  })

  it('201: an APN is combined into the sent SMS (2001 + server params in one setparam)', async () => {
    const before = enqueued.length
    const res = await req(port, `/v1/devices/${deviceId}/sms`, adminToken, 'POST', { apn: 'banga' })
    expect(res.status).toBe(201)
    const delivery = (await res.json()) as { body: string }
    // the device with no auto-APN gets data AND the server address from this single SMS
    expect(delivery.body).toBe('  setparam 2001:banga;2004:orbetra.com;2005:5027;2006:0')
    expect(enqueued[before]!.body).toBe('  setparam 2001:banga;2004:orbetra.com;2005:5027;2006:0')
  })

  it('201: an explicit body overrides the generated config SMS', async () => {
    const before = enqueued.length
    const res = await req(port, `/v1/devices/${deviceId}/sms`, adminToken, 'POST', { body: 'custom command' })
    expect(res.status).toBe(201)
    const delivery = (await res.json()) as { body: string }
    expect(delivery.body).toBe('custom command')
    expect(enqueued[before]!.body).toBe('custom command')
  })

  it('403: a viewer cannot send (hardware onboarding is a write → ACCOUNT_WRITERS)', async () => {
    const before = enqueued.length
    expect((await req(port, `/v1/devices/${deviceId}/sms`, viewerToken, 'POST', {})).status).toBe(403)
    expect(enqueued.length).toBe(before) // nothing enqueued on a rejected request
  })

  it('403: a Direct-plan (direct_10) tenant lacks smsGateway → plan_upgrade_required', async () => {
    const res = await req(port, `/v1/devices/${directDeviceId}/sms`, directToken, 'POST', {})
    expect(res.status).toBe(403)
    expect(((await res.json()) as { detail?: string }).detail).toBe('plan_upgrade_required')
  })

  it('404: a cross-tenant device (never leaks the row); an unknown device id → 404', async () => {
    expect((await req(port, `/v1/devices/${deviceId}/sms`, crossToken, 'POST', {})).status).toBe(404)
    expect((await req(port, `/v1/devices/999999999/sms`, adminToken, 'POST', {})).status).toBe(404)
  })

  it('503: the platform has no SMS driver configured (deps.sms undefined) — before the msisdn check', async () => {
    const res = await req(portNoSms, `/v1/devices/${deviceId}/sms`, adminToken, 'POST', {})
    expect(res.status).toBe(503)
  })

  it('400: the device has no SIM phone number', async () => {
    const before = enqueued.length
    expect((await req(port, `/v1/devices/${noMsisdnId}/sms`, adminToken, 'POST', {})).status).toBe(400)
    expect(enqueued.length).toBe(before)
  })

  it('503 + marks the delivery failed when the enqueue itself throws (no stuck queued ghost)', async () => {
    failEnqueue.on = true
    try {
      const res = await req(port, `/v1/devices/${deviceId}/sms`, adminToken, 'POST', {})
      expect(res.status).toBe(503)
    } finally {
      failEnqueue.on = false
    }
    // the freshly-created row was flipped queued → failed (the worker never sees it)
    const list = (await (await req(port, `/v1/devices/${deviceId}/sms`, adminToken)).json()) as { status: string }[]
    expect(list.some((d) => d.status === 'failed')).toBe(true)
  })

  it('onboarding sheet reports smsEnabled per platform config (true with the seam, false without)', async () => {
    const on = (await (await req(port, `/v1/devices/${deviceId}/onboarding`, adminToken)).json()) as { smsEnabled: boolean; smsServer: string }
    expect(on.smsEnabled).toBe(true)
    expect(on.smsServer).toBe(CONFIG_SMS)
    const off = (await (await req(portNoSms, `/v1/devices/${deviceId}/onboarding`, adminToken)).json()) as { smsEnabled: boolean }
    expect(off.smsEnabled).toBe(false)
  })
})
