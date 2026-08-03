import { randomUUID } from 'node:crypto'

import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Redis } from 'ioredis'

import { SignupEmailInUseError, type Db } from '@orbetra/db'
import { signupSchema } from '@orbetra/shared'

import { hashPassword } from '../auth/passwords.js'
import { clientIp } from '../net.js'

/**
 * PUBLIC self-serve signup (F2, item 5/W9): a direct small-fleet customer creates their own tenant +
 * admin user on a 14-day trial — the second unauthenticated write after pilot-request, with the same
 * abuse posture:
 *  - HONEYPOT: a non-empty `hp_field` gets the SAME 201 shape as success (random id, nothing stored).
 *  - RATE LIMIT per real client IP (rightmost XFF behind Caddy), atomic INCR+EXPIRE, fails OPEN.
 *  - zod-validated; body size capped here (mounted before the global /v1 limiter).
 *
 * Trial mechanics: tenant gets plan `direct_10`, subscriptionStatus 'trialing' and currentPeriodEnd =
 * now + 14 days. The AUTHORITATIVE entitlement gate (db.tenants.getEntitlements) floors a `trialing`
 * tenant past that instant — no sweep needed, expiry is immediate. Upgrading via Stripe replaces the
 * status through the ordinary webhook path. NO session is returned — the web app sends the user through
 * the normal login (single auth path; signup never mints tokens).
 *
 * Attribution: `ref` resolves via getActiveByCode (case-insensitive, ACTIVE only) → referredByAffiliateId;
 * an unknown/inactive code attributes to no one and never blocks the signup.
 */
export interface SignupRouteDeps {
  db: Db
  redis: Redis
  getRemoteAddr: (c: unknown) => string
  trustProxy: boolean
  rateLimit?: { max: number; windowS: number }
}

// 30 days — the publicly advertised trial. The marketing site AND the Terms of Service both state
// "free trials run for 30 days without a card", so the backend must grant exactly that; a shorter
// window would break a contractual promise.
const TRIAL_DAYS = 30
const TRIAL_PLAN = 'direct_10' as const

// atomic fixed-window (mirrors pilotRequest): INCR, TTL on first hit, re-arm a stranded key
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

export function createSignupRoute(deps: SignupRouteDeps): Hono {
  const app = new Hono()
  const limit = deps.rateLimit ?? { max: 5, windowS: 3600 }
  // tiny payload — cap the unauthenticated POST before it buffers (parity with partner routes)
  app.use('/v1/public/signup', bodyLimit({ maxSize: 64 * 1024 }))

  app.post('/v1/public/signup', async (c: Context) => {
    const parsed = signupSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)
    const body = parsed.data

    // honeypot: indistinguishable fake success — random id, store nothing
    if (body.hp_field !== undefined && body.hp_field !== '') return c.json({ ok: true, id: randomUUID() }, 201)

    try {
      const ip = clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)
      const n = (await deps.redis.eval(RL_SCRIPT, 1, `signup:rl:${ip}`, String(limit.windowS))) as number
      if (n > limit.max) return c.json({ error: 'rate limited' }, 429)
    } catch {
      /* fail OPEN on a Redis blip — a lost signup costs more than rare spam */
    }

    const email = body.email.trim().toLowerCase()
    // attribution BEFORE the transaction (read-only): active code → affiliate, else none
    const ref = body.ref !== undefined ? await deps.db.affiliates.getActiveByCode(body.ref) : null

    try {
      const created = await deps.db.tenants.createSelfServeSignup({
        tenantName: body.company?.trim() ? body.company.trim() : `${body.name.trim()}'s fleet`,
        accountName: 'My fleet',
        email,
        passwordHash: await hashPassword(body.password),
        plan: TRIAL_PLAN,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 3_600_000),
        referredByAffiliateId: ref?.id ?? null,
      })
      return c.json({ ok: true, id: created.tenantId }, 201)
    } catch (err) {
      if (err instanceof SignupEmailInUseError) return c.json({ error: 'email_in_use' }, 409)
      throw err
    }
  })

  return app
}
