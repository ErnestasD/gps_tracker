import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { LiveEvent } from '@orbetra/shared'

import { createApp, type WsDeps } from '../src/index.js'
import { tenantDevicesKey } from '../src/routes/deviceRegistry.js'
import { mintTestToken, testApiDeps } from './helpers/auth.js'

let container: StartedTestContainer
let redis: Redis
let redisSub: Redis
let deps: WsDeps

const CTX_TENANT = { userId: 'u1', tenantId: 't1', role: 'tsp_admin' as const } // tenant-wide
const CTX_ACC = { userId: 'u2', tenantId: 't1', accountId: 'acc-a', role: 'account_manager' as const }
let TOKEN_TENANT: string
let TOKEN_ACC: string

let tenantPort: number
let accPort: number
const servers: ReturnType<typeof createServer>[] = []

const compact = (deviceId: string, accountId: string | null): LiveEvent => ({
  deviceId,
  accountId,
  fixTimeMs: 1_751_600_000_000,
  lat: 54.68,
  lon: 25.27,
  speed: 40,
  course: 90,
  satellites: 9,
  fixValid: true,
  ignition: true,
  priority: 0,
})

async function seedDevice(deviceId: string, tenant: string, account: string | null): Promise<void> {
  await redis.hset('device:tenant', deviceId, tenant)
  await redis.sadd(tenantDevicesKey(tenant), deviceId) // per-tenant index — what the route reads
  if (account !== null) await redis.hset('device:account', deviceId, account)
  const event = compact(deviceId, account)
  await redis.hset(`device:${deviceId}:last`, {
    fixTimeMs: String(event.fixTimeMs),
    json: JSON.stringify(event),
  })
}

async function startApp(): Promise<number> {
  const app = createApp(testApiDeps(deps))
  const server = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  servers.push(server)
  return new Promise<number>((resolve) => {
    server.on('listening', () => resolve((server.address() as { port: number }).port))
  })
}

const getLast = async (port: number, token?: string): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/v1/devices/last`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  const opts = { maxRetriesPerRequest: null }
  redis = new Redis(container.getMappedPort(6379), container.getHost(), opts)
  redisSub = new Redis(container.getMappedPort(6379), container.getHost(), opts)
  deps = { redis, redisSub, ticketTtlS: 30 }
  TOKEN_TENANT = await mintTestToken(CTX_TENANT)
  TOKEN_ACC = await mintTestToken(CTX_ACC)
  tenantPort = await startApp()
  accPort = tenantPort // one app — identity now travels in the JWT, not app config
}, 120_000)

afterAll(async () => {
  for (const s of servers) {
    s.closeAllConnections?.()
    await new Promise<void>((r) => s.close(() => r()))
  }
  await redis.quit()
  await redisSub.quit()
  await container.stop()
})

beforeEach(async () => {
  await redis.flushall()
})

describe('E02-6 GET /v1/devices/last snapshot', () => {
  it('requires auth (401 RFC7807 without/with wrong token)', async () => {
    expect((await getLast(tenantPort)).status).toBe(401)
    expect((await getLast(tenantPort, 'wrong')).status).toBe(401)
  })

  it('returns only the caller tenant devices, sorted, verbatim LiveEvent shape (§6.2 isolation)', async () => {
    await seedDevice('dev-b', 't1', 'acc-b')
    await seedDevice('dev-a', 't1', 'acc-a')
    await seedDevice('dev-x', 't2', null) // other tenant — must never leak
    const res = await getLast(tenantPort, TOKEN_TENANT)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { devices: LiveEvent[] }
    expect(body.devices.map((d) => d.deviceId)).toEqual(['dev-a', 'dev-b'])
    expect(body.devices[0]).toEqual(compact('dev-a', 'acc-a'))
  })

  it('account-scoped ctx sees only its account; unmapped device fails CLOSED (ws.ts parity)', async () => {
    await seedDevice('dev-a', 't1', 'acc-a')
    await seedDevice('dev-b', 't1', 'acc-b')
    await seedDevice('dev-u', 't1', null) // in tenant but unmapped account
    const body = (await (await getLast(accPort, TOKEN_ACC)).json()) as { devices: LiveEvent[] }
    expect(body.devices.map((d) => d.deviceId)).toEqual(['dev-a'])
  })

  it('devices mapped but never reported are omitted; malformed state is skipped not fatal', async () => {
    await seedDevice('dev-a', 't1', null)
    await redis.hset('device:tenant', 'dev-silent', 't1') // no :last hash
    await redis.sadd(tenantDevicesKey('t1'), 'dev-silent')
    await redis.hset('device:tenant', 'dev-broken', 't1')
    await redis.sadd(tenantDevicesKey('t1'), 'dev-broken')
    await redis.hset('device:dev-broken:last', { fixTimeMs: '1', json: '{not json' })
    const res = await getLast(tenantPort, TOKEN_TENANT)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { devices: LiveEvent[] }
    expect(body.devices.map((d) => d.deviceId)).toEqual(['dev-a'])
  })

  it('empty tenant → empty list (not an error)', async () => {
    const body = (await (await getLast(tenantPort, TOKEN_TENANT)).json()) as { devices: LiveEvent[] }
    expect(body.devices).toEqual([])
  })

  it('a STALE index member cannot leak another tenant device (index is a hint, not the authority)', async () => {
    // The per-tenant set is derived state with several writers (CRUD activate/deactivate, boot
    // rehydrate) — assume it CAN drift. `device:tenant` stays authoritative and the route
    // re-verifies every candidate against it, so drift costs a wasted lookup, never a leak.
    await seedDevice('dev-a', 't1', null)
    await seedDevice('dev-x', 't2', null) // genuinely t2's
    await redis.sadd(tenantDevicesKey('t1'), 'dev-x') // …but wrongly indexed under t1
    await redis.sadd(tenantDevicesKey('t1'), 'dev-gone') // and one that no longer exists at all
    const body = (await (await getLast(tenantPort, TOKEN_TENANT)).json()) as { devices: LiveEvent[] }
    expect(body.devices.map((d) => d.deviceId)).toEqual(['dev-a'])
  })

  it('does not scan the platform: another tenant fleet costs the caller nothing', async () => {
    // Regression guard for the audit finding. The route used to HGETALL `device:tenant` — every
    // device on the platform — so this assertion is about the SHAPE of the read, not the output:
    // the caller must touch only its own index.
    await seedDevice('dev-a', 't1', null)
    for (let i = 0; i < 200; i++) await seedDevice(`t2-dev-${i}`, 't2', null)
    const body = (await (await getLast(tenantPort, TOKEN_TENANT)).json()) as { devices: LiveEvent[] }
    expect(body.devices.map((d) => d.deviceId)).toEqual(['dev-a'])
    expect(await redis.scard(tenantDevicesKey('t1'))).toBe(1) // caller's index stayed small
    expect(await redis.hlen('device:tenant')).toBe(201) // the platform-wide hash did NOT
  })

  it('rate-limits per user (audit MED: unrate-limited snapshot was a free platform scan)', async () => {
    await seedDevice('dev-a', 't1', null)
    const port = await startApp()
    // default is 60/min; drive one user past it and expect 429 rather than unbounded work
    let last = 200
    for (let i = 0; i < 62 && last === 200; i++) last = (await getLast(port, TOKEN_TENANT)).status
    expect(last).toBe(429)
    // …and a DIFFERENT user is unaffected (the window is keyed per user, not global)
    expect((await getLast(port, TOKEN_ACC)).status).toBe(200)
  })
})
