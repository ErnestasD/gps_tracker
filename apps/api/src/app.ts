import { Hono } from 'hono'
import { Gauge, Registry } from 'prom-client'

import { liveEventSchema, type LiveEvent } from '@orbetra/shared'

import { issueTicket, type WsAuthContext, type WsDeps } from './ws.js'

export interface AuthStub {
  /** TEMPORARY until E03-1 (story-sanctioned stub): Bearer token → fixed test user.
   * E03-1 replaces this with argon2id + JWT middleware and MUST delete this type. */
  token: string
  ctx: WsAuthContext
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

export function createApp(deps: WsDeps, auth: AuthStub, prom?: ApiProm): Hono {
  const app = new Hono()

  app.get('/healthz', (c) => c.text('ok'))

  if (prom) {
    app.get('/metrics', async (c) => c.text(await prom.registry.metrics()))
  }

  // §6.6: GET /v1/ws-ticket (auth'd) → single-use ticket for wss://…/v1/stream?ticket=
  app.get('/v1/ws-ticket', async (c) => {
    const header = c.req.header('authorization')
    if (header !== `Bearer ${auth.token}`) {
      return c.json({ title: 'Unauthorized', status: 401 }, 401) // RFC 7807 shape
    }
    const ticket = await issueTicket(deps, auth.ctx)
    c.header('Cache-Control', 'no-store') // single-use credential: never cacheable
    return c.json({ ticket, expiresInS: deps.ticketTtlS ?? 30 })
  })

  // TEMPORARY until E03-3 (founder-approved E02-6 addition): last-known snapshot so the
  // web map isn't empty until each device next reports. Reads the Redis hashes LiveState
  // maintains; E03-3 replaces this with a scoped repository in packages/db and deletes
  // the direct hash walk (HGETALL is fine at stub scale, not at 5k devices).
  app.get('/v1/devices/last', async (c) => {
    const header = c.req.header('authorization')
    if (header !== `Bearer ${auth.token}`) {
      return c.json({ title: 'Unauthorized', status: 401 }, 401)
    }
    const tenantMap = await deps.redis.hgetall('device:tenant')
    const deviceIds = Object.keys(tenantMap)
      .filter((id) => tenantMap[id] === auth.ctx.tenantId)
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
        // fanout on (review MED: a hash re-read could disagree with the stored payload
        // and make devices flicker between snapshot and first WS frame); unmapped
        // (null) fails CLOSED for account-scoped users
        if (auth.ctx.accountId !== undefined && parsed.data.accountId !== auth.ctx.accountId) continue
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
