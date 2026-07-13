import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'
import { pilotRequestSchema } from '@orbetra/shared'

/**
 * PUBLIC pilot-request endpoint (W9-S1, §6.6/§6.9) — the marketing site's only form.
 * Registered BEFORE the auth middleware; manifest-EXEMPT. Abuse posture:
 *  - HONEYPOT: a non-empty `website` field gets a fake 200 and stores NOTHING — the
 *    bot never learns it was detected.
 *  - RATE LIMIT per source IP, fixed window (default 5/hour). Fails OPEN on a Redis
 *    blip: a lost lead costs real money, a rare spam burst costs nothing (leads are
 *    read by a human platform_admin).
 *  - zod-validated body; oversized/garbage → 400.
 */
export interface PilotRequestDeps {
  db: Db
  redis: Redis
  getRemoteAddr: (c: unknown) => string
  rateLimit?: { max: number; windowS: number }
}

export function createPilotRequestRoute(deps: PilotRequestDeps): Hono {
  const app = new Hono()
  const limit = deps.rateLimit ?? { max: 5, windowS: 3600 }

  app.post('/v1/public/pilot-request', async (c: Context) => {
    const parsed = pilotRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)
    const body = parsed.data

    // honeypot: pretend success, store nothing (a visible rejection teaches the bot)
    if (body.website !== undefined && body.website !== '') return c.json({ ok: true })

    try {
      const ip = deps.getRemoteAddr(c)
      const key = `pilot:rl:${ip}`
      const n = await deps.redis.incr(key)
      if (n === 1) await deps.redis.expire(key, limit.windowS)
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
