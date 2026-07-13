import { randomUUID } from 'node:crypto'

import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'
import { pilotRequestSchema } from '@orbetra/shared'

import { clientIp } from '../net.js'

/**
 * PUBLIC pilot-request endpoint (W9-S1, §6.6/§6.9) — the marketing site's only form and
 * the platform's ONLY unauthenticated write. Registered BEFORE the auth middleware;
 * manifest-EXEMPT. Abuse posture:
 *  - HONEYPOT: a non-empty `hp_field` gets the SAME 201 shape as success (random id,
 *    nothing stored) so a bot can't A/B-detect the trap or its field name (review MED).
 *  - RATE LIMIT per REAL client IP (rightmost XFF behind Caddy, review HIGH — keying on
 *    the socket peer would be one global bucket = the whole internet shares 5/hour).
 *    One atomic INCR+EXPIRE (review MED: a non-atomic pair could strand a TTL-less key
 *    and 429 forever). Fails OPEN on a Redis blip: a lost lead costs more than rare spam.
 *  - zod-validated body; oversized/garbage → 400. Body size is bounded upstream (Caddy
 *    request_body max_size on the /v1 handle).
 */
export interface PilotRequestDeps {
  db: Db
  redis: Redis
  getRemoteAddr: (c: unknown) => string
  trustProxy: boolean
  rateLimit?: { max: number; windowS: number }
}

// atomic fixed-window: INCR then set TTL only on the first hit; re-arm a stranded key
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

export function createPilotRequestRoute(deps: PilotRequestDeps): Hono {
  const app = new Hono()
  const limit = deps.rateLimit ?? { max: 5, windowS: 3600 }

  app.post('/v1/public/pilot-request', async (c: Context) => {
    const parsed = pilotRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)
    const body = parsed.data

    // honeypot: indistinguishable fake success — random id, store nothing
    if (body.hp_field !== undefined && body.hp_field !== '') return c.json({ ok: true, id: randomUUID() }, 201)

    try {
      const ip = clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)
      const n = (await deps.redis.eval(RL_SCRIPT, 1, `pilot:rl:${ip}`, String(limit.windowS))) as number
      if (n > limit.max) return c.json({ error: 'rate limited' }, 429)
    } catch {
      /* fail OPEN — see header */
    }

    const lead = await deps.db.leads.create({
      name: body.name,
      company: body.company,
      email: body.email,
      phone: body.phone || null,
      deviceCount: body.deviceCount || null,
      message: body.message || null,
      ref: body.ref ?? null,
    })
    return c.json({ ok: true, id: lead.id }, 201)
  })

  return app
}
