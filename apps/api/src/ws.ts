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
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
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
