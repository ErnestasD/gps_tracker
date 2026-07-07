import { Hono } from 'hono'
import { Gauge, Registry } from 'prom-client'

import type { AuthDb } from '@orbetra/db'
import { liveEventSchema, type LiveEvent } from '@orbetra/shared'

import { createAuthRoutes } from './auth/login.js'
import { authMiddleware, type AuthEnv } from './auth/middleware.js'
import { issueTicket, type WsDeps } from './ws.js'

export interface ApiDeps extends WsDeps {
  db: AuthDb
  jwtSecret: string
  jwtTtlS: number
  refreshTtlS: number
  lockout: { maxFails: number; windowS: number }
  secureCookies: boolean
  trustProxy: boolean
  /** Remote socket address resolver (Node server adapter specific; tests inject). */
  getRemoteAddr?: (c: unknown) => string
}

export interface ApiProm {
  registry: Registry
  setWsClients: (n: number) => void
}

export function createApiProm(): ApiProm {
  const registry = new Registry()
  const g = new Gauge({ name: 'ws_clients', help: 'live WS connections', registers: [registry] })
  return { registry, setWsClients: (n) => g.set(n) }
}

export function createApp(deps: ApiDeps, prom?: ApiProm): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>()

  app.get('/healthz', (c) => c.text('ok'))

  if (prom) {
    app.get('/metrics', async (c) => c.text(await prom.registry.metrics()))
  }

  // §6.6 auth routes (login/refresh/logout public; /me guards itself)
  app.route('/v1/auth', createAuthRoutes(deps, deps.getRemoteAddr ?? (() => '0.0.0.0')))

  // everything below /v1/* requires a valid access JWT (registration order — Hono
  // middleware applies only to handlers registered after it)
  app.use('/v1/*', authMiddleware({ jwtSecret: deps.jwtSecret }))

  // §6.6: GET /v1/ws-ticket → single-use ticket for wss://…/v1/stream?ticket=
  // (any authenticated role — live map is viewer-accessible)
  app.get('/v1/ws-ticket', async (c) => {
    const auth = c.get('auth')
    const ticket = await issueTicket(deps, auth)
    c.header('Cache-Control', 'no-store') // single-use credential: never cacheable
    return c.json({ ticket, expiresInS: deps.ticketTtlS ?? 30 })
  })

  // TEMPORARY until E03-3 (founder-approved E02-6 addition): last-known snapshot so the
  // web map isn't empty until each device next reports. Reads the Redis hashes LiveState
  // maintains; E03-3 replaces this with a scoped repository in packages/db and deletes
  // the direct hash walk (HGETALL is fine at stub scale, not at 5k devices).
  app.get('/v1/devices/last', async (c) => {
    const auth = c.get('auth')
    const tenantMap = await deps.redis.hgetall('device:tenant')
    const deviceIds = Object.keys(tenantMap)
      .filter((id) => tenantMap[id] === auth.tenantId)
      .sort()
    const jsons = await Promise.all(
      deviceIds.map((id) => deps.redis.hget(`device:${id}:last`, 'json')),
    )
    const devices: LiveEvent[] = []
    for (const raw of jsons) {
      if (raw === null) continue // mapped but never reported
      try {
        const parsed = liveEventSchema.safeParse(JSON.parse(raw))
        if (!parsed.success) continue // malformed state is skipped, not fatal
        // account filter on the PAYLOAD accountId — the same field ws.ts filters the
        // fanout on; unmapped (null) fails CLOSED for account-scoped users
        if (auth.accountId !== undefined && parsed.data.accountId !== auth.accountId) continue
        devices.push(parsed.data)
      } catch {
        // broken JSON in the hash — skip
      }
    }
    c.header('Cache-Control', 'no-store') // tenant-scoped positions: never cacheable
    return c.json({ devices })
  })

  return app
}
