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
 * admin user on a 30-day trial — the second unauthenticated write after pilot-request, hardened for
 * the fact that it creates real tenants:
 *  - HONEYPOT: a non-empty `hp_field` gets the SAME 201 shape as success (random id, nothing stored).
 *  - RATE LIMIT per real client IP + a platform-wide circuit breaker, atomic INCR+EXPIRE, fails CLOSED.
 *  - zod-validated; body size capped here (mounted before the global /v1 limiter).
 *
 * Trial mechanics: tenant gets plan `direct_10`, subscriptionStatus 'trialing' and currentPeriodEnd =
 * now + 30 days (the publicly advertised length). The AUTHORITATIVE entitlement gate (db.tenants.getEntitlements) floors a `trialing`
 * tenant past that instant — no sweep needed, expiry is immediate. Upgrading via Stripe replaces the
 * status through the ordinary webhook path. NO session is returned — the web app sends the user through
 * the normal login (single auth path; signup never mints tokens).
 *
 * Attribution: `ref` resolves via getActiveByCode (EXACT lower(code) match, ACTIVE only) → referredByAffiliateId;
 * an unknown/inactive code attributes to no one and never blocks the signup.
 */
export interface SignupRouteDeps {
  db: Db
  redis: Redis
  getRemoteAddr: (c: unknown) => string
  trustProxy: boolean
  /** per-IP cap + a platform-wide circuit breaker; both fail CLOSED. */
  rateLimit?: { max: number; windowS: number; globalMax?: number }
}

// 30 days — the publicly advertised trial. The marketing site AND the Terms of Service both state
// "free trials run for 30 days without a card", so the backend must grant exactly that; a shorter
// window would break a contractual promise.
/** Jittered stand-in for a real signup's latency — timing equivalence WITHOUT touching argon2. */
const HONEYPOT_DELAY_MS = 200
const TRIAL_DAYS = 30
const TRIAL_PLAN = 'direct_10' as const

// atomic fixed-window (mirrors pilotRequest): INCR, TTL on first hit, re-arm a stranded key
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

export function createSignupRoute(deps: SignupRouteDeps): Hono {
  const app = new Hono()
  const cfg = deps.rateLimit ?? { max: 5, windowS: 3600 }
  const limit = { ...cfg, globalMax: cfg.globalMax ?? Math.max(cfg.max * 40, 200) }
  // tiny payload — cap the unauthenticated POST before it buffers (parity with partner routes)
  app.use('/v1/public/signup', bodyLimit({ maxSize: 64 * 1024 }))

  app.post('/v1/public/signup', async (c: Context) => {
    const parsed = signupSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)
    const body = parsed.data

    // FAIL CLOSED (unlike pilot-request, which fails open because a lost lead is unrecoverable).
    // This route creates a tenant + account + admin user + billing object, and it is the only thing
    // standing between the open internet and mass tenant creation — a Redis blip must not turn it
    // into an unlimited endpoint. A signup the user can simply retry is the cheaper failure.
    // A GLOBAL bucket sits behind the per-IP one as a circuit breaker: a distributed flood spreads
    // across IPs but still has to fit under the platform-wide ceiling, which also protects the
    // shared argon2 semaphore (hashPassword) that login depends on.
    //
    // This runs BEFORE the honeypot branch (audit high): the honeypot also hashes, so while it sat
    // above these buckets it was an unauthenticated, unlimited path straight into the process-wide
    // 8-slot argon2 semaphore that tenant login, password change/reset and partner login all share.
    // Sustained honeypot traffic from one host pinned every slot and queued real logins behind it —
    // a platform-wide authentication outage triggered by setting one JSON field.
    try {
      const ip = clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)
      const perIp = (await deps.redis.eval(RL_SCRIPT, 1, `signup:rl:${ip}`, String(limit.windowS))) as number
      if (perIp > limit.max) return c.json({ error: 'rate limited' }, 429)
      const global = (await deps.redis.eval(RL_SCRIPT, 1, 'signup:rl:global', String(limit.windowS))) as number
      if (global > limit.globalMax) return c.json({ error: 'rate limited' }, 429)
    } catch (err) {
      console.error('signup rate-limit unavailable', err)
      return c.json({ error: 'temporarily unavailable' }, 503)
    }

    // HONEYPOT: a fake success indistinguishable from the real thing — same body shape, random id,
    // nothing stored. It still has to SPEND time, because returning instantly would let a bot A/B
    // the trap by timing even though the JSON matches — but it spends it SLEEPING, not hashing.
    // Real argon2 here handed anonymous traffic a free path into the process-wide semaphore that
    // login depends on; the trap only ever needed the latency, never the work (audit high).
    if (body.hp_field !== undefined && body.hp_field !== '') {
      await new Promise((r) => setTimeout(r, HONEYPOT_DELAY_MS * (0.85 + 0.3 * Math.random())))
      return c.json({ ok: true, id: randomUUID() }, 201)
    }

    const email = body.email.trim().toLowerCase()
    // attribution BEFORE the transaction (read-only): active code → affiliate, else none
    const candidate = body.ref !== undefined ? await deps.db.affiliates.getActiveByCode(body.ref) : null
    // SELF-REFERRAL GUARD (PROJECT_PLAN §6.9): a partner must not earn commission on their own
    // subscription. Signing up with an email in the affiliate's own domain drops the attribution —
    // the tenant is still created, it simply earns nobody a commission.
    const domainOf = (e: string) => e.slice(e.lastIndexOf('@') + 1).toLowerCase()
    const selfReferral = candidate !== null && domainOf(candidate.email) === domainOf(email)
    if (selfReferral) console.warn('signup: self-referral attribution dropped', candidate.code)
    const ref = selfReferral ? null : candidate

    try {
      const created = await deps.db.tenants.createSelfServeSignup({
        tenantName: body.company?.trim() ? body.company.trim() : `${body.name.trim()}'s fleet`,
        accountName: 'My fleet',
        email,
        passwordHash: await hashPassword(body.password),
        plan: TRIAL_PLAN,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 3_600_000),
        referredByAffiliateId: ref?.id ?? null,
        // the signup form sends the browser's IANA zone; it is the account's REPORTING zone (hard
        // rule 7), not a display preference. Absent ⇒ UTC, the old behaviour, which was only ever
        // right for a customer whose day genuinely starts at 00:00 UTC.
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      })
      return c.json({ ok: true, id: created.tenantId }, 201)
    } catch (err) {
      if (err instanceof SignupEmailInUseError) return c.json({ error: 'email_in_use' }, 409)
      throw err
    }
  })

  return app
}
