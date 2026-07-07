import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { LiveEvent } from '@orbetra/shared'

import { createApp, type WsDeps } from '../src/index.js'

let container: StartedTestContainer
let redis: Redis
let redisSub: Redis
let deps: WsDeps

const TOKEN_TENANT = 'stub-tenant-token'
const TOKEN_ACC = 'stub-account-token'
const CTX_TENANT = { userId: 'u1', tenantId: 't1' } // tenant-wide
const CTX_ACC = { userId: 'u2', tenantId: 't1', accountId: 'acc-a' }

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
  if (account !== null) await redis.hset('device:account', deviceId, account)
  const event = compact(deviceId, account)
  await redis.hset(`device:${deviceId}:last`, {
    fixTimeMs: String(event.fixTimeMs),
    json: JSON.stringify(event),
  })
}

async function startApp(token: string, ctx: typeof CTX_TENANT | typeof CTX_ACC): Promise<number> {
  const app = createApp(deps, { token, ctx })
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
  tenantPort = await startApp(TOKEN_TENANT, CTX_TENANT)
  accPort = await startApp(TOKEN_ACC, CTX_ACC)
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
    await redis.hset('device:tenant', 'dev-broken', 't1')
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
})
