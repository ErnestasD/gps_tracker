import { randomBytes } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { Redis } from 'ioredis'
import { WebSocketServer, type WebSocket } from 'ws'

import { WS_CLOSE, type Role } from '@orbetra/shared'

export interface WsAuthContext {
  userId: string
  tenantId: string
  /** undefined ⇒ tenant-wide visibility (tsp_admin); set ⇒ single-account scope */
  accountId?: string
  /** carried for future per-role socket features (E08-2 commands); the fanout
   * filter keys on accountId presence only. Tickets live 30 s — no compat window. */
  role: Role
  /** When the ticket was minted (ms). The socket's revocation clock starts HERE, not at redemption:
   *  a holder who pre-fetches tickets in a loop would otherwise redeem one AFTER a revoke and get an
   *  `establishedAt` newer than the marker, making the sweep a permanent miss (review high). */
  issuedAtMs?: number
}

export interface WsDeps {
  redis: Redis
  /** Separate connection: a subscribed ioredis client cannot run other commands. */
  redisSub: Redis
  ticketTtlS?: number // §6.7 WS_TICKET_TTL=30
  /** How often the gateway re-validates live sockets against the revocation marker
   *  (audit MED — revoked sessions must not keep a live stream). Default 15 s. */
  revokeCheckIntervalMs?: number
  /** Hard ceiling on one socket's lifetime (default 4 h). A stream is authorized only at connect,
   *  so this is what makes plan/role/scope changes eventually reach an already-open one. */
  maxSocketLifetimeMs?: number
  /** Heartbeat period (default 30 s). A socket that misses one round trip is terminated — without
   *  it a half-open connection lingers until the OS keepalive, ~2 h on Linux. */
  pingIntervalMs?: number
  /** Send-buffer ceiling per socket before it is cut as a slow consumer (default 1 MB). */
  maxBufferedBytes?: number
  /** Consecutive unanswered pings before a socket is terminated (default 2 — see the note below). */
  pingMissesBeforeTerminate?: number
}

/** Redis key prefix for the "all sessions revoked at" marker (audit MED). */
export const WS_REVOKE_PREFIX = 'ws:revoke:'
/** Marker TTL — comfortably longer than any access-token TTL / expected socket lifetime. */
const WS_REVOKE_TTL_S = 24 * 3_600
// Close codes live in @orbetra/shared: the SPA's reconnect policy branches on them, and a code
// only the server knows is a signal the client cannot act on.
/** WS close code for a revoked session (application range; distinct from protocol codes). */
export const WS_REVOKED_CLOSE = WS_CLOSE.REVOKED
/** WS close code for a subscriber that stopped reading fast enough to keep up with its feed. */
export const WS_SLOW_CONSUMER_CLOSE = WS_CLOSE.SLOW_CONSUMER
/**
 * How much unread data may sit in one socket's send buffer before we cut it.
 *
 * A live position payload is a few hundred bytes, so 1 MB is thousands of updates behind — far
 * past "briefly busy" and squarely at "this peer is gone". Below this the socket is simply slow;
 * above it, it is a memory leak with a URL.
 */
export const MAX_WS_BUFFERED_BYTES = 1024 * 1024
/** Grace for a cut subscriber to complete the closing handshake before the socket is destroyed. */
const SLOW_CONSUMER_TERMINATE_MS = 1_000

/**
 * Record that EVERY session of `userId` was revoked at `at` (ms). The WS gateway tears down any
 * socket that was established BEFORE this instant on its next re-validation tick — a password
 * change / admin reset revokes refresh families (HTTP), but a socket opened earlier would keep
 * streaming live positions without this (audit MED). Best-effort: a Redis blip must never fail
 * the password change itself, so it swallows errors (incl. a stub redis in unit tests).
 */
export async function markSessionsRevoked(redis: Redis, userId: string, at: number = Date.now()): Promise<void> {
  try {
    await redis.set(`${WS_REVOKE_PREFIX}${userId}`, String(at), 'EX', WS_REVOKE_TTL_S)
  } catch {
    /* best-effort */
  }
}

/**
 * True when the user's sessions were revoked AFTER `tokenIssuedAtS` — i.e. this access token predates
 * a logout / delete / password reset / scope change and must NOT be allowed to open a fresh WS stream
 * (audit B1). Closes the gap where a still-unexpired token minted before the revocation opened a new
 * socket whose establishedAt was NEWER than the revoke instant, so the gateway's periodic sweep never
 * tore it down. The JWT `iat` is second-granular while the marker is ms, so we compare at SECOND
 * granularity — a token minted in the SAME second as (even just after) a revoke is NOT rejected
 * (it is a legitimately re-issued token; only a token from a STRICTLY earlier second is stale). The
 * sub-second slip is harmless — the gateway's periodic sweep still tears down established sockets.
 * Fail-open on a redis blip (matches markSessionsRevoked's best-effort posture; sweep is the backstop).
 */
export async function revokedAt(redis: Redis, userId: string, atMs: number): Promise<boolean> {
  try {
    const raw = await redis.get(`${WS_REVOKE_PREFIX}${userId}`)
    if (raw === null) return false
    const revokedAtMs = Number(raw)
    return Number.isFinite(revokedAtMs) && revokedAtMs >= atMs
  } catch {
    return false // Redis blip: fail open here, the periodic sweep is the backstop
  }
}

export async function revokedAfter(redis: Redis, userId: string, tokenIssuedAtS: number | undefined): Promise<boolean> {
  if (tokenIssuedAtS === undefined) return false
  try {
    const raw = await redis.get(`${WS_REVOKE_PREFIX}${userId}`)
    if (raw === null) return false
    const revokedAtMs = Number(raw)
    return Number.isFinite(revokedAtMs) && Math.floor(revokedAtMs / 1000) > tokenIssuedAtS
  } catch {
    return false
  }
}

/**
 * Single-use ws-ticket auth (PROJECT_PLAN §5 realtime, R8-6): `GET /v1/ws-ticket`
 * stores a random 32 B token via SETEX 30 s; the WS upgrade consumes it with GETDEL —
 * reuse or expiry ⇒ refused. Never a raw JWT in a query string (§10 failure #10).
 */
export async function issueTicket(deps: WsDeps, ctx: WsAuthContext): Promise<string> {
  const ticket = randomBytes(32).toString('hex')
  await deps.redis.setex(`ticket:${ticket}`, deps.ticketTtlS ?? 30, JSON.stringify({ ...ctx, issuedAtMs: Date.now() }))
  return ticket
}

/**
 * WS gateway (E02-4): upgrade `GET /v1/stream?ticket=…`, subscribe the socket to its
 * tenant's `live:{tenantId}` channel; account-scoped users only receive messages for
 * devices of their account (server-side filter via `device:account` hash, synced by
 * E03-3 device CRUD; unknown mapping ⇒ NOT delivered to account-scoped users).
 */
export function attachWsGateway(
  server: Server,
  deps: WsDeps,
  onClientCountChange?: (n: number) => void,
  /** Fired when a socket is cut for falling too far behind its feed — a slow-consumer rate is a
   *  client or network problem, and without a counter it is invisible. */
  onSlowConsumer?: () => void,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  // same reasoning as the per-socket handler below: an unhandled 'error' on the server object is an
  // uncaught exception, and this one is not attached to any one tenant's connection
  wss.on('error', () => undefined)
  const subscribers = new Map<string, Set<{ ws: WebSocket; ctx: WsAuthContext; establishedAt: number }>>()
  let subPromise: Promise<void> | null = null

  // Periodically re-validate every live socket against the revocation marker (audit MED): a
  // socket authorized before a password change / admin reset must be closed, else session
  // revocation never reaches the one long-lived read credential. Cheap: one MGET over the
  // DISTINCT user ids currently connected.
  const revokeMs = deps.revokeCheckIntervalMs ?? 15_000
  const maxLifetimeMs = deps.maxSocketLifetimeMs ?? 4 * 3_600_000
  const revokeTimer = setInterval(() => {
    void (async () => {
      const entries: { ws: WebSocket; ctx: WsAuthContext; establishedAt: number }[] = []
      for (const set of subscribers.values()) for (const e of set) entries.push(e)
      if (entries.length === 0) return
      const userIds = [...new Set(entries.map((e) => e.ctx.userId))]
      let markers: (string | null)[]
      try {
        markers = await deps.redis.mget(...userIds.map((u) => `${WS_REVOKE_PREFIX}${u}`))
      } catch {
        return // Redis blip — try again next tick
      }
      const revokedAt = new Map<string, number>()
      userIds.forEach((u, i) => {
        const v = markers[i]
        if (v != null) revokedAt.set(u, Number(v))
      })
      const now = Date.now()
      for (const e of entries) {
        const t = revokedAt.get(e.ctx.userId)
        // A socket opened at-or-before the revocation instant is no longer authorized. The MAX
        // LIFETIME is the second half of that guarantee (audit high): a stream is authorized exactly
        // once, at connect, so without a ceiling nothing on an OPEN socket is ever re-evaluated — a
        // plan downgrade to FLOOR_ENTITLEMENTS, an account move, a role change all keep streaming
        // until the process restarts. Closing forces a reconnect with a fresh ticket, which
        // re-authorizes; the SPA reconnects with backoff, so this is invisible in normal use.
        if ((t !== undefined && t >= e.establishedAt) || now - e.establishedAt > maxLifetimeMs) {
          try {
            e.ws.close(WS_REVOKED_CLOSE, t !== undefined && t >= e.establishedAt ? 'session revoked' : 'reauthorize')
          } catch {
            /* already closing */
          }
        }
      }
    })()
  }, revokeMs)
  revokeTimer.unref?.()

  // HEARTBEAT. Nothing pinged: `WebSocketServer` does not do it by itself, so a half-open TCP
  // connection — laptop lid closed, mobile handover, NAT timeout — kept `readyState === OPEN` and
  // stayed in `subscribers` until the OS keepalive fired, which on Linux defaults to ~2 hours. The
  // API would happily write a fleet's entire position stream into a socket whose peer vanished
  // ninety minutes ago. A socket is terminated rather than closed politely once it goes quiet:
  // there is no peer left to negotiate with. Audit MED.
  //
  // TWO missed round trips, not one. At a 30 s interval a single-strike reaper kills any client
  // that stalls for 30 s — a lift, a tunnel, an LTE handover — and the SPA reconnects into a fresh
  // ticket + upgrade. Two strikes is the conventional 2×-interval tolerance. Because the strike is
  // counted BEFORE the ping that would clear it, a socket that goes silent is reaped on the third
  // tick — ~90 s at the default interval, which is the number to size an alert on.
  const strikes = new WeakMap<WebSocket, number>()
  const pingMs = deps.pingIntervalMs ?? 30_000
  const maxBuffered = deps.maxBufferedBytes ?? MAX_WS_BUFFERED_BYTES
  const missesBeforeTerminate = deps.pingMissesBeforeTerminate ?? 2
  const pingTimer = setInterval(() => {
    for (const set of subscribers.values()) {
      for (const { ws } of set) {
        const missed = (strikes.get(ws) ?? 0) + 1
        if (missed > missesBeforeTerminate) {
          ws.terminate()
          continue
        }
        strikes.set(ws, missed)
        try {
          ws.ping()
        } catch {
          /* already closing */
        }
      }
    }
  }, pingMs)
  pingTimer.unref?.()

  wss.on('close', () => {
    clearInterval(revokeTimer)
    clearInterval(pingTimer)
  })

  const ensureSubscription = (): Promise<void> => {
    // promise (not flag): a second concurrent upgrade awaits the ACTUAL subscription
    subPromise ??= (async () => {
      await deps.redisSub.psubscribe('live:*')
      deps.redisSub.on('pmessage', (_pattern, channel, message) => {
        const tenantId = channel.slice('live:'.length)
        const conns = subscribers.get(tenantId)
        if (!conns || conns.size === 0) return
        let accountId: string | null = null
        try {
          accountId = (JSON.parse(message) as { accountId?: string | null }).accountId ?? null
        } catch {
          return // crafted/broken publish — drop
        }
        for (const { ws, ctx } of conns) {
          // in-memory scope filter: accountId travels in the payload (LiveState);
          // unmapped device (null) fails CLOSED for account-scoped users
          if (ctx.accountId !== undefined && accountId !== ctx.accountId) continue
          try {
            if (ws.readyState !== ws.OPEN) continue
            // BACKPRESSURE. `ws` queues everything the peer has not read into the process heap, and
            // Node's socket write buffer is unbounded — so a subscriber that stops reading (a phone
            // that lost signal, a laptop lid closed mid-handover) had the tenant's ENTIRE live feed
            // accumulate in API memory until the process died. There is no useful way to slow a
            // position stream down, so the honest policy is to cut the socket: the client
            // reconnects and re-reads current state, which is what it wanted anyway. Audit MED.
            if (ws.bufferedAmount > maxBuffered) {
              onSlowConsumer?.()
              // close() first, so a client that IS reading learns why and can back off; but a peer
              // that stalled will never complete the closing handshake, and `ws` then holds the
              // socket — and everything already queued on it — for its full 30 s close timeout.
              // That is the memory we are trying to release, so the wait is bounded to 1 s.
              ws.close(WS_SLOW_CONSUMER_CLOSE, 'too slow')
              setTimeout(() => {
                if (ws.readyState !== ws.CLOSED) ws.terminate()
              }, SLOW_CONSUMER_TERMINATE_MS).unref?.()
              continue
            }
            ws.send(message)
          } catch {
            // one closing socket must not starve the rest of the fanout
          }
        }
      })
    })()
    return subPromise
  }

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/v1/stream') {
        socket.destroy()
        return
      }
      const ticket = url.searchParams.get('ticket')
      const raw = ticket ? await deps.redis.getdel(`ticket:${ticket}`) : null // single-use
      if (raw === null) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      const ctx = JSON.parse(raw) as WsAuthContext
      // A ticket authorizes as of the moment it was ISSUED. Refuse one that predates a revocation
      // rather than letting the socket open and waiting for the sweep — and anchor `establishedAt`
      // to issue time so a revoke landing in the redemption window is caught by the sweep too.
      // Without this an API-key or JWT holder who kept a fresh ticket in hand simply redeemed it
      // after the revoke and streamed on: `establishedAt > marker` made `t >= establishedAt` a
      // permanent miss, so REST 401'd while the live feed kept flowing (review high).
      const establishedAt = ctx.issuedAtMs ?? Date.now()
      if (await revokedAt(deps.redis, ctx.userId, establishedAt)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      await ensureSubscription()
      wss.handleUpgrade(req, socket, head, (ws) => {
        const entry = { ws, ctx, establishedAt }
        // A socket with NO 'error' listener is a process killer: `ws` emits 'error' on any protocol
        // violation (a frame with RSV1 set, a bad mask, an oversized control frame), and Node's
        // EventEmitter THROWS ERR_UNHANDLED_ERROR when nothing is listening. Any holder of a valid
        // ws-ticket — i.e. any logged-in user of any tenant — could take the whole API down with one
        // malformed frame, killing every tenant's REST, WS and login at once. Terminate that socket
        // and let the rest of the platform carry on.
        ws.on('error', () => {
          try {
            ws.terminate()
          } catch {
            /* already gone */
          }
        })
        // a fresh socket starts with a clean slate; every pong clears the strikes it accrued
        strikes.set(ws, 0)
        ws.on('pong', () => strikes.set(ws, 0))
        const set = subscribers.get(ctx.tenantId) ?? new Set()
        set.add(entry)
        subscribers.set(ctx.tenantId, set)
        onClientCountChange?.(wss.clients.size)
        ws.on('close', () => {
          set.delete(entry)
          if (set.size === 0) subscribers.delete(ctx.tenantId)
          onClientCountChange?.(wss.clients.size)
        })
      })
    })().catch(() => socket.destroy())
  })

  return wss
}
