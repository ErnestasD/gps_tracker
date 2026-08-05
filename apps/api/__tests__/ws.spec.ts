import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { attachWsGateway, createApp, issueTicket, type WsDeps } from '../src/index.js'
import { markSessionsRevoked, WS_REVOKED_CLOSE, WS_SLOW_CONSUMER_CLOSE } from '../src/ws.js'
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

  it('a ticket held ACROSS a revoke is refused at redemption — the sweep alone was a permanent miss', async () => {
    // REGRESSION (review high): the sweep compares the revoke marker against `establishedAt`, which
    // was stamped at REDEMPTION. A holder who kept a fresh ticket in hand simply redeemed it after
    // the revoke: establishedAt > marker, so `t >= establishedAt` never matched and the socket
    // streamed on. REST 401'd and the UI showed the credential revoked while the live feed flowed.
    const uid = `held-ticket-${Date.now()}`
    const ticket = await issueTicket(deps, { userId: uid, tenantId: 't1', role: 'tsp_admin' })
    await new Promise((r) => setTimeout(r, 5)) // the revoke lands AFTER the ticket was minted
    await markSessionsRevoked(redis, uid)
    await expect(connect(ticket)).rejects.toThrow(/401/)
  })

  it('a socket is closed once it hits the max lifetime — the only re-authorization an open stream gets', async () => {
    // A stream is authorized exactly once, at connect: without a ceiling a plan downgrade, account
    // move or role change never reaches an already-open socket. The client reconnects with a fresh
    // ticket, which re-authorizes; the close code is the same 4401 the SPA already handles.
    const lifeDeps: WsDeps = { redis, redisSub, ticketTtlS: 30, revokeCheckIntervalMs: 40, maxSocketLifetimeMs: 60 }
    const srv = serve({ fetch: createApp(testApiDeps(lifeDeps)).fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    const localWss = attachWsGateway(srv, lifeDeps)
    try {
      const ticket = await issueTicket(lifeDeps, { userId: `life-${Date.now()}`, tenantId: 't1', role: 'tsp_admin' })
      const ws = new WebSocket(`ws://127.0.0.1:${p}/v1/stream?ticket=${ticket}`)
      const closed = new Promise<{ code: number; reason: string }>((resolve) =>
        ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
      )
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
      })
      const res = await Promise.race([
        closed,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('socket outlived its ceiling')), 3_000)),
      ])
      expect(res.code).toBe(WS_REVOKED_CLOSE)
      expect(res.reason).toBe('reauthorize') // distinguishable from a real revocation
    } finally {
      srv.closeAllConnections?.()
      await new Promise<void>((r) => srv.close(() => r()))
      localWss.close()
    }
  })

  it('cuts a subscriber whose send buffer runs away — one dead peer must not buffer the tenant feed', async () => {
    // REGRESSION (audit MED). The fanout was `if (OPEN) ws.send(message)` with no ceiling: `ws`
    // queues everything the peer has not read into the process heap and Node's socket buffer is
    // unbounded, so a phone that lost signal mid-handover accumulated its tenant's ENTIRE live feed
    // in API memory. Here the client's TCP socket is PAUSED, which is exactly what a vanished peer
    // looks like from the server: still OPEN, never reading, and never acknowledging anything —
    // which is why the assertion is made on the SERVER's signal, not on a client close event that a
    // stalled peer by definition cannot deliver.
    let slowConsumers = 0
    const bpDeps: WsDeps = { redis, redisSub, ticketTtlS: 30, maxBufferedBytes: 1 }
    const srv = serve({ fetch: createApp(testApiDeps(bpDeps)).fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    const localWss = attachWsGateway(srv, bpDeps, undefined, () => { slowConsumers++ })
    let ws: WebSocket | undefined
    try {
      const ticket = await issueTicket(bpDeps, { userId: `slow-${Date.now()}`, tenantId: 't-slow', role: 'tsp_admin' })
      ws = new WebSocket(`ws://127.0.0.1:${p}/v1/stream?ticket=${ticket}`)
      const closed = new Promise<number>((resolve) => ws!.on('close', (code) => resolve(code)))
      await new Promise<void>((resolve, reject) => {
        ws!.once('open', () => resolve())
        ws!.once('error', reject)
      })
      // stop reading at the socket level: the kernel receive window closes, the server's writes
      // stop draining, and its bufferedAmount climbs — no cooperation from the client library needed
      const sock = (ws as unknown as { _socket: { pause: () => void; resume: () => void } })._socket
      sock.pause()

      const payload = JSON.stringify({ deviceId: '1', accountId: null, filler: 'x'.repeat(8_000) })
      const t0 = Date.now()
      while (slowConsumers === 0) {
        if (Date.now() - t0 > 10_000) throw new Error('slow consumer was never cut')
        for (let i = 0; i < 200; i++) await redis.publish('live:t-slow', payload)
        await new Promise((r) => setTimeout(r, 25))
      }
      // the peer, once it reads again, learns WHY — a distinct code the SPA can act on
      sock.resume()
      expect(
        await Promise.race([
          closed,
          new Promise<number>((_, rej) => setTimeout(() => rej(new Error('no close frame')), 5_000)),
        ]),
      ).toBe(WS_SLOW_CONSUMER_CLOSE)
      // …and the server-side socket is released, not merely marked closing: everything queued on it
      // is what we were trying to free
      const t1 = Date.now()
      while (localWss.clients.size > 0) {
        if (Date.now() - t1 > 3_000) throw new Error('cut socket was never released')
        await new Promise((r) => setTimeout(r, 25))
      }
    } finally {
      ws?.terminate() // a stalled peer never completes the closing handshake; do not wait for it
      srv.closeAllConnections?.()
      await new Promise<void>((r) => srv.close(() => r()))
      localWss.close()
    }
  })

  it('a malformed frame kills the SOCKET, never the process (an unhandled ws error is fatal to Node)', async () => {
    // `ws` emits 'error' on any protocol violation, and Node's EventEmitter THROWS
    // ERR_UNHANDLED_ERROR when nothing listens — so one crafted frame from any holder of a valid
    // ws-ticket took down every tenant's REST, WS and login at once. The frame below sets RSV1 with
    // no extension negotiated, which the receiver must reject.
    const c = await connect(await issueTicket(deps, CTX_TENANT))
    const closed = new Promise<void>((resolve) => c.ws.on('close', () => resolve()))
    const sock = (c.ws as unknown as { _socket: { write: (b: Buffer) => void } })._socket
    sock.write(Buffer.from([0xc1, 0x80, 0x00, 0x00, 0x00, 0x00])) // FIN|RSV1|text, masked, len 0
    await Promise.race([
      closed,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('socket survived a bad frame')), 3_000)),
    ])
    // the gateway is still serving: a second client connects and receives its feed
    const survivor = await connect(await issueTicket(deps, CTX_TENANT))
    await new Promise((r) => setTimeout(r, 100))
    await redis.publish('live:t1', JSON.stringify({ deviceId: '900', accountId: null, lat: 1, lon: 1 }))
    expect((await waitForCount(survivor, 1)).length).toBe(1)
    survivor.ws.close()
  })

  it('terminates a socket that stops answering pings — a half-open TCP link is invisible otherwise', async () => {
    // Without a heartbeat a connection whose peer vanished without a FIN stays readyState OPEN in
    // `subscribers` until the OS keepalive fires (~2 h on Linux): it counts against ws_clients, and
    // every fanout writes to it. `autoPong: false` makes the client behave exactly like that peer.
    const hbDeps: WsDeps = { redis, redisSub, ticketTtlS: 30, pingIntervalMs: 60 }
    const srv = serve({ fetch: createApp(testApiDeps(hbDeps)).fetch, port: 0, createServer }) as ReturnType<typeof createServer>
    const p = await new Promise<number>((r) => srv.on('listening', () => r((srv.address() as { port: number }).port)))
    const localWss = attachWsGateway(srv, hbDeps)
    try {
      const ticket = await issueTicket(hbDeps, { userId: `hb-${Date.now()}`, tenantId: 't-hb', role: 'tsp_admin' })
      const ws = new WebSocket(`ws://127.0.0.1:${p}/v1/stream?ticket=${ticket}`, { autoPong: false })
      const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()))
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
      })
      await Promise.race([
        closed,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('unresponsive socket was never reaped')), 5_000)),
      ])
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
