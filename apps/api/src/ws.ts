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
  const subscribers = new Map<string, Set<{ ws: WebSocket; ctx: WsAuthContext }>>()
  let subPromise: Promise<void> | null = null

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
        const entry = { ws, ctx }
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
