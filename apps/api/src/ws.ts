import { randomBytes } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { Redis } from 'ioredis'
import { WebSocketServer, type WebSocket } from 'ws'

import type { Role } from '@orbetra/shared'

export interface WsAuthContext {
  userId: string
  tenantId: string
  /** undefined ⇒ tenant-wide visibility (tsp_admin); set ⇒ single-account scope */
  accountId?: string
  /** carried for future per-role socket features (E08-2 commands); the fanout
   * filter keys on accountId presence only. Tickets live 30 s — no compat window. */
  role: Role
}

export interface WsDeps {
  redis: Redis
  /** Separate connection: a subscribed ioredis client cannot run other commands. */
  redisSub: Redis
  ticketTtlS?: number // §6.7 WS_TICKET_TTL=30
  /** How often the gateway re-validates live sockets against the revocation marker
   *  (audit MED — revoked sessions must not keep a live stream). Default 15 s. */
  revokeCheckIntervalMs?: number
}

/** Redis key prefix for the "all sessions revoked at" marker (audit MED). */
export const WS_REVOKE_PREFIX = 'ws:revoke:'
/** Marker TTL — comfortably longer than any access-token TTL / expected socket lifetime. */
const WS_REVOKE_TTL_S = 24 * 3_600
/** WS close code for a revoked session (application range; distinct from protocol codes). */
export const WS_REVOKED_CLOSE = 4401

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
 * Single-use ws-ticket auth (PROJECT_PLAN §5 realtime, R8-6): `GET /v1/ws-ticket`
 * stores a random 32 B token via SETEX 30 s; the WS upgrade consumes it with GETDEL —
 * reuse or expiry ⇒ refused. Never a raw JWT in a query string (§10 failure #10).
 */
export async function issueTicket(deps: WsDeps, ctx: WsAuthContext): Promise<string> {
  const ticket = randomBytes(32).toString('hex')
  await deps.redis.setex(`ticket:${ticket}`, deps.ticketTtlS ?? 30, JSON.stringify(ctx))
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
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  const subscribers = new Map<string, Set<{ ws: WebSocket; ctx: WsAuthContext; establishedAt: number }>>()
  let subPromise: Promise<void> | null = null

  // Periodically re-validate every live socket against the revocation marker (audit MED): a
  // socket authorized before a password change / admin reset must be closed, else session
  // revocation never reaches the one long-lived read credential. Cheap: one MGET over the
  // DISTINCT user ids currently connected.
  const revokeMs = deps.revokeCheckIntervalMs ?? 15_000
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
      for (const e of entries) {
        const t = revokedAt.get(e.ctx.userId)
        // a socket opened at-or-before the revocation instant is no longer authorized
        if (t !== undefined && t >= e.establishedAt) {
          try {
            e.ws.close(WS_REVOKED_CLOSE, 'session revoked')
          } catch {
            /* already closing */
          }
        }
      }
    })()
  }, revokeMs)
  revokeTimer.unref?.()
  wss.on('close', () => clearInterval(revokeTimer))

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
            if (ws.readyState === ws.OPEN) ws.send(message)
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
      await ensureSubscription()
      wss.handleUpgrade(req, socket, head, (ws) => {
        const entry = { ws, ctx, establishedAt: Date.now() }
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
