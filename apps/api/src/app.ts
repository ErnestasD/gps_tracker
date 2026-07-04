import { Hono } from 'hono'
import { Gauge, Registry } from 'prom-client'

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
    return c.json({ ticket, expiresInS: deps.ticketTtlS ?? 30 })
  })

  return app
}
