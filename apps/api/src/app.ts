import { Hono } from 'hono'

import { issueTicket, type WsAuthContext, type WsDeps } from './ws.js'

export interface AuthStub {
  /** TEMPORARY until E03-1 (story-sanctioned stub): Bearer token → fixed test user.
   * E03-1 replaces this with argon2id + JWT middleware and MUST delete this type. */
  token: string
  ctx: WsAuthContext
}

export function createApp(deps: WsDeps, auth: AuthStub): Hono {
  const app = new Hono()

  app.get('/healthz', (c) => c.text('ok'))

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
