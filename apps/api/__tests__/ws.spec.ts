import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { attachWsGateway, createApp, issueTicket, type WsDeps } from '../src/index.js'
import { markSessionsRevoked, WS_REVOKED_CLOSE } from '../src/ws.js'
import { mintTestToken, testApiDeps } from './helpers/auth.js'

let container: StartedTestContainer
let redis: Redis
let redisSub: Redis
let deps: WsDeps
let port: number
let httpServer: ReturnType<typeof createServer>

const CTX_A = { userId: 'u1', tenantId: 't1', accountId: 'acc-a', role: 'account_manager' as const }
const CTX_TENANT = { userId: 'u2', tenantId: 't1', role: 'tsp_admin' as const } // tenant-wide

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  const opts = { maxRetriesPerRequest: null }
  redis = new Redis(container.getMappedPort(6379), container.getHost(), opts)
  redisSub = new Redis(container.getMappedPort(6379), container.getHost(), opts)
  deps = { redis, redisSub, ticketTtlS: 30 }

  const app = createApp(testApiDeps(deps))
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
  it('ws-ticket endpoint requires auth (JWT) and issues a ticket', async () => {
    const denied = await fetch(`http://127.0.0.1:${port}/v1/ws-ticket`)
    expect(denied.status).toBe(401)
    const garbage = await fetch(`http://127.0.0.1:${port}/v1/ws-ticket`, {
      headers: { authorization: 'Bearer not-a-jwt' },
    })
    expect(garbage.status).toBe(401)
    const ok = await fetch(`http://127.0.0.1:${port}/v1/ws-ticket`, {
      headers: { authorization: `Bearer ${await mintTestToken(CTX_TENANT)}` },
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

  it('cross-TENANT isolation: t2 subscriber never receives live:t1 messages (§6.2)', async () => {
    const t2 = await connect(await issueTicket(deps, { userId: 'u9', tenantId: 't2', role: 'tsp_admin' }))
    const t1 = await connect(await issueTicket(deps, CTX_TENANT))
    await new Promise((r) => setTimeout(r, 100))
    await redis.publish('live:t1', JSON.stringify({ deviceId: '42', accountId: null, lat: 1, lon: 1 }))
    await waitForCount(t1, 1)
    await new Promise((r) => setTimeout(r, 400))
    expect(t2.inbox).toHaveLength(0)
    t1.ws.close()
    t2.ws.close()
  })

  it('closes an already-established socket once its session is revoked (audit MED)', async () => {
    // dedicated gateway with a fast re-validation interval so the test is quick + deterministic
    const revDeps: WsDeps = { redis, redisSub, ticketTtlS: 30, revokeCheckIntervalMs: 150 }
    const srv = serve({ fetch: createApp(testApiDeps(revDeps)).fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    const localWss = attachWsGateway(srv, revDeps)
    try {
      const uid = `revoke-${Date.now()}`
      const ticket = await issueTicket(revDeps, { userId: uid, tenantId: 't1', role: 'tsp_admin' })
      const ws = new WebSocket(`ws://127.0.0.1:${p}/v1/stream?ticket=${ticket}`)
      const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
      })
      // revoke every session of this user (as a password change / admin reset does) → the next
      // re-validation tick must tear the live socket down with the revoked close code
      await markSessionsRevoked(redis, uid)
      const code = await Promise.race([
        closed,
        new Promise<number>((_, rej) => setTimeout(() => rej(new Error('socket was NOT closed on revoke')), 3_000)),
      ])
      expect(code).toBe(WS_REVOKED_CLOSE)
    } finally {
      srv.closeAllConnections?.()
      await new Promise<void>((r) => srv.close(() => r()))
      localWss.close()
    }
  })

  it('account scope: user of account A never receives account B device events', async () => {
    const a = await connect(await issueTicket(deps, CTX_A))
    const tenant = await connect(await issueTicket(deps, CTX_TENANT))
    await new Promise((r) => setTimeout(r, 100))

    await redis.publish('live:t1', JSON.stringify({ deviceId: '200', accountId: 'acc-b', lat: 1, lon: 1 }))
    await redis.publish('live:t1', JSON.stringify({ deviceId: '100', accountId: 'acc-a', lat: 2, lon: 2 }))

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
