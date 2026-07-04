import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { attachWsGateway, createApp, issueTicket, type WsDeps } from '../src/index.js'

let container: StartedTestContainer
let redis: Redis
let redisSub: Redis
let deps: WsDeps
let port: number
let httpServer: ReturnType<typeof createServer>

const TOKEN = 'stub-test-token'
const CTX_A = { userId: 'u1', tenantId: 't1', accountId: 'acc-a' }
const CTX_TENANT = { userId: 'u2', tenantId: 't1' } // tenant-wide (tsp_admin)

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  const opts = { maxRetriesPerRequest: null }
  redis = new Redis(container.getMappedPort(6379), container.getHost(), opts)
  redisSub = new Redis(container.getMappedPort(6379), container.getHost(), opts)
  deps = { redis, redisSub, ticketTtlS: 30 }

  const app = createApp(deps, { token: TOKEN, ctx: CTX_A })
  httpServer = serve({ fetch: app.fetch, port: 0, createServer }) as ReturnType<typeof createServer>
  attachWsGateway(httpServer, deps)
  port = await new Promise<number>((resolve) => {
    httpServer.on('listening', () => resolve((httpServer.address() as { port: number }).port))
  })
}, 120_000)

afterAll(async () => {
  httpServer.closeAllConnections?.()
  await new Promise<void>((r) => httpServer.close(() => r()))
  await redis.quit()
  await redisSub.quit()
  await container.stop()
})

interface Client {
  ws: WebSocket
  inbox: string[]
}

const connect = (ticket: string): Promise<Client> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/stream?ticket=${ticket}`)
    const inbox: string[] = []
    ws.on('message', (data: Buffer) => inbox.push(data.toString())) // buffer from t0
    ws.once('open', () => resolve({ ws, inbox }))
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
  })

async function waitForCount(c: Client, n: number, timeoutMs = 3_000): Promise<string[]> {
  const t0 = Date.now()
  while (c.inbox.length < n) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`ws message timeout (${c.inbox.length}/${n})`)
    await new Promise((r) => setTimeout(r, 25))
  }
  return c.inbox
}

describe('E02-4 ws-ticket + live gateway', () => {
  it('ws-ticket endpoint requires auth and issues a ticket', async () => {
    const denied = await fetch(`http://127.0.0.1:${port}/v1/ws-ticket`)
    expect(denied.status).toBe(401)
    const ok = await fetch(`http://127.0.0.1:${port}/v1/ws-ticket`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ticket: string }
    expect(body.ticket).toHaveLength(64)
  })

  it('live message reaches a subscribed client <2 s after publish', async () => {
    const ticket = await issueTicket(deps, CTX_TENANT)
    const client = await connect(ticket)
    await new Promise((r) => setTimeout(r, 100)) // psubscribe settles
    const payload = { deviceId: '42', fixTimeMs: Date.now(), lat: 54.7, lon: 25.3 }
    const t0 = Date.now()
    await redis.publish('live:t1', JSON.stringify(payload))
    const [raw] = await waitForCount(client, 1)
    expect(Date.now() - t0).toBeLessThan(2_000)
    expect((JSON.parse(raw!) as { deviceId: string }).deviceId).toBe('42')
    client.ws.close()
  })

  it('ticket is single-use: second connect with the same ticket is refused', async () => {
    const ticket = await issueTicket(deps, CTX_TENANT)
    const client = await connect(ticket)
    await expect(connect(ticket)).rejects.toThrow(/401/)
    client.ws.close()
  })

  it('expired ticket is refused', async () => {
    const shortDeps = { ...deps, ticketTtlS: 1 }
    const ticket = await issueTicket(shortDeps, CTX_TENANT)
    await new Promise((r) => setTimeout(r, 1_100))
    await expect(connect(ticket)).rejects.toThrow(/401/)
  })

  it('account scope: user of account A never receives account B device events', async () => {
    await redis.hset('device:account', '100', 'acc-a', '200', 'acc-b')
    const a = await connect(await issueTicket(deps, CTX_A))
    const tenant = await connect(await issueTicket(deps, CTX_TENANT))
    await new Promise((r) => setTimeout(r, 100))

    await redis.publish('live:t1', JSON.stringify({ deviceId: '200', lat: 1, lon: 1 }))
    await redis.publish('live:t1', JSON.stringify({ deviceId: '100', lat: 2, lon: 2 }))

    // tenant-wide user sees both; account-A user must see ONLY device 100
    const both = await waitForCount(tenant, 2)
    expect(both.map((m) => (JSON.parse(m) as { deviceId: string }).deviceId).sort()).toEqual(['100', '200'])

    const aMsgs = await waitForCount(a, 1)
    await new Promise((r) => setTimeout(r, 400)) // grace: nothing else may arrive
    expect(a.inbox).toHaveLength(1)
    expect((JSON.parse(aMsgs[0]!) as { deviceId: string }).deviceId).toBe('100')
    a.ws.close()
    tenant.ws.close()
  })
})
