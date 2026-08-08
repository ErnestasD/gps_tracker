import { createHash, randomBytes } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'
import { partnerLoginSchema, partnerSetPasswordSchema } from '@orbetra/shared'

// one implementation of the lockout primitives for BOTH login surfaces — partner had its own
// byte-identical copies, which is how two surfaces drift apart without anyone noticing
import { count, gateRead, ADMIT_SCRIPT, DECAY_SCRIPT, FAIL_SOURCE_SCRIPT, KNOWN_GOOD_TTL_S, LOCKOUT_SCRIPT as RL_SCRIPT, UNMARKED_ADMIT_EVERY } from '../auth/gates.js'
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from '../auth/passwords.js'
import { problem } from '../auth/middleware.js'
import { mintPartnerToken, verifyPartnerToken } from '../auth/partnerJwt.js'
import { clientIp } from '../net.js'

/**
 * Partner (affiliate) self-service auth + read API (F5). A partner is NOT a tenant user, so this is a
 * fully separate surface: login/set-password are PUBLIC (mounted before the tenant auth guard), and
 * me/commissions are guarded by a partner-only middleware that never touches tenant scope. A partner
 * only ever sees THEIR OWN affiliate row + commissions (scoped by the verified token's subject).
 */
export interface PartnerRouteDeps {
  db: Db
  redis: Redis
  jwtSecret: string
  /** partner access-token TTL (no refresh); default 8h — a low-sensitivity read-only view. */
  partnerTtlS?: number
  /** set/reset-password token lifetime; default 24h (an admin-conveyed invite link). */
  setPwTokenTtlS?: number
  trustProxy: boolean
  getRemoteAddr: (c: unknown) => string
  /** Login ceilings; each falls back to this module's default. Threaded from env so a partner
   *  locked out during an incident can be freed without a redeploy — the tenant login already
   *  had that and the doc comment claimed parity the operability did not have. */
  loginLimits?: {
    maxFails?: number
    maxFailsPerIp?: number
    maxAttemptsPerIpHard?: number
    maxFailIpsPerEmail?: number
  }
  /** A lockout gate refused a partner login — same counter the tenant login feeds, so the
   *  `auth_lockout_tripped_total` series is not blind to half the authentication surface. */
  onLockout?: (gate: 'credential' | 'ip' | 'email' | 'degraded') => void
}

// the affiliate row shape, derived from the repo (avoids importing @prisma/client — rule 2)
type Affiliate = NonNullable<Awaited<ReturnType<Db['affiliates']['get']>>>
type PartnerEnv = { Variables: { partner: Affiliate } }

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
const DEFAULT_TTL_S = 8 * 3_600
const DEFAULT_SETPW_TTL_S = 24 * 3_600
// Defaults for the same three ceilings the tenant login carries (audit MED) — see the long gate
// note in `auth/login.ts` for why each sits where it does. Overridable per deployment via
// `PartnerRouteDeps.loginLimits`, so a ceiling can be raised during an incident without a redeploy.
const LOGIN_RL_MAX = 10 // per (IP, email) attempts, pre-verify
const LOGIN_RL_MAX_IP = 60 // SOFT: per-IP FAILURES, post-verify — never denies a valid credential
const LOGIN_RL_MAX_ATTEMPTS_IP_HARD = 2_000 // HARD: per-IP ATTEMPTS, pre-verify — the CPU shed
const LOGIN_RL_MAX_FAIL_IPS = 30 // DISTINCT source IPs failing against one partner account
const REDEEM_RL_MAX = 30 // set-password redeem attempts per IP per window
const RL_WINDOW_S = 3_600

/** Partner-only auth guard: a valid `typ:'partner'` token → loads the affiliate and requires it to
 *  still be ACTIVE (review MED — so suspending a partner takes effect immediately, not at token TTL,
 *  and a deleted affiliate can't keep reading). The loaded row is put on the context for reuse. */
function partnerAuth(deps: PartnerRouteDeps) {
  return async (c: Context<PartnerEnv>, next: () => Promise<void>) => {
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (token === '') return problem(c, 401, 'Unauthorized')
    const claims = await verifyPartnerToken(token, deps.jwtSecret)
    if (claims === null) return problem(c, 401, 'Unauthorized')
    const partner = await deps.db.affiliates.get(claims.sub)
    if (partner === null || partner.status !== 'active') return problem(c, 401, 'Unauthorized')
    c.set('partner', partner)
    await next()
  }
}

export function createPartnerRoutes(deps: PartnerRouteDeps): Hono<PartnerEnv> {
  const app = new Hono<PartnerEnv>()
  // tiny bodies (email/token/password) — cap the unauthenticated POSTs so an oversized body can't
  // amplify memory (review LOW: these mount before the global /v1/* limiter, so they need their own)
  app.use('/v1/partner/*', bodyLimit({ maxSize: 64 * 1024 }))
  const ttlS = deps.partnerTtlS ?? DEFAULT_TTL_S
  const ip = (c: Context) => clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)

  // ── PUBLIC: login ────────────────────────────────────────────────────────────
  app.post('/v1/partner/login', async (c) => {
    const parsed = partnerLoginSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request', 'email and password required')
    const email = parsed.data.email.trim().toLowerCase()
    // Same three gates, same placement rules, as the tenant login — see the long note in
    // `auth/login.ts`. Briefly: the per-credential rule is incremented and gated on one atomic
    // result (a check-then-act gate around argon2 bounds nothing under concurrency); the hard
    // per-IP ATTEMPT ceiling sheds CPU pre-verify and is never refunded; the soft per-IP FAILURE
    // ceiling is post-verify so an office is never denied a valid credential; and the account
    // ceiling counts DISTINCT source IPs, because counting attempts pre-verify would let one host
    // lock a named partner out of the portal and counting them post-verify would bound nothing.
    // Affiliate emails are the most public identifiers on the platform.
    const lim = deps.loginLimits
    const maxCred = lim?.maxFails ?? LOGIN_RL_MAX
    const maxFailsIp = lim?.maxFailsPerIp ?? LOGIN_RL_MAX_IP
    const maxAttemptsIpHard = lim?.maxAttemptsPerIpHard ?? LOGIN_RL_MAX_ATTEMPTS_IP_HARD
    const maxFailIps = lim?.maxFailIpsPerEmail ?? LOGIN_RL_MAX_FAIL_IPS
    const emailHash = sha256(email).slice(0, 16)
    const src = ip(c)
    const lockKey = `partner:fail:${src}:${emailHash}`
    const failIpKey = `partner:fail:ip:${src}`
    const attemptIpKey = `partner:attempt:ip:${src}`
    const emailIpsKey = `partner:fail:ips:${emailHash}`
    const okIpKey = `partner:ok:ip:${src}`
    const w = String(RL_WINDOW_S)
    const tooMany = async (key: string, gate: 'credential' | 'ip' | 'email'): Promise<Response> => {
      deps.onLockout?.(gate)
      const ttl = await deps.redis.ttl(key).catch(() => RL_WINDOW_S)
      c.header('Retry-After', String(Math.max(1, ttl)))
      return problem(c, 429, 'Too Many Attempts', 'try again later')
    }
    // gateRead/count: identical degradation posture to the tenant login — an unevaluable gate
    // fails OPEN, deliberately and metered, rather than 500ing or hanging (see `auth/gates.ts`)
    const pre = await gateRead(deps, () =>
      deps.redis.pipeline().get(attemptIpKey).pfcount(emailIpsKey).get(failIpKey).exists(okIpKey).exec(),
    )
    // `pre === null` = a gate could not be evaluated; skip them all rather than read absent values
    // as zero (which would also invert fail-open for a ceiling configured to 0). See auth/gates.ts.
    if (pre !== null) {
      if (count(pre[0]) >= maxAttemptsIpHard) return tooMany(attemptIpKey, 'ip')
      if (count(pre[1]) >= maxFailIps) return tooMany(emailIpsKey, 'email')
      // soft ceiling on an unmarked bucket: throttled to one in N, never refused outright — a hard
      // refusal is a renewable lockout for everyone on that egress, and this window is an HOUR
      if (count(pre[2]) >= maxFailsIp && count(pre[3]) === 0) {
        const admitted = await gateRead(deps, () =>
          deps.redis
            .pipeline()
            .eval(ADMIT_SCRIPT, 1, `partner:admit:ip:${src}`, String(UNMARKED_ADMIT_EVERY), w)
            .exec(),
        )
        if (admitted !== null && count(admitted[0]) === 0) return tooMany(failIpKey, 'ip')
      }
    }
    const bumped = await gateRead(deps, () =>
      deps.redis.pipeline().eval(RL_SCRIPT, 1, lockKey, w).eval(RL_SCRIPT, 1, attemptIpKey, w).exec(),
    )
    if (bumped !== null) {
      if (count(bumped[0]) > maxCred) return tooMany(lockKey, 'credential')
      if (count(bumped[1]) > maxAttemptsIpHard) return tooMany(attemptIpKey, 'ip')
    }
    const partner = await deps.db.affiliates.findByEmailForAuth(email)
    // constant-ish time: an unknown email / unset password still burns one dummy verify
    const hash = partner?.passwordHash ?? (await DUMMY_HASH_PROMISE)
    const ok = await verifyPassword(hash, parsed.data.password)
    // only an ACTIVE partner with a set password + matching credential may sign in
    if (partner === null || partner.passwordHash === null || !ok || partner.status !== 'active') {
      const failed = await gateRead(deps, () =>
        deps.redis
          .pipeline()
          .eval(RL_SCRIPT, 1, failIpKey, w)
          .eval(FAIL_SOURCE_SCRIPT, 1, emailIpsKey, src, w)
          .exec(),
      )
      if (failed !== null && count(failed[0]) > maxFailsIp) return tooMany(failIpKey, 'ip')
      return problem(c, 401, 'Unauthorized', 'invalid credentials')
    }
    // the per-credential counter is cleared outright; the per-IP FAILURE budget only DECAYS by one,
    // and the ATTEMPT counter is untouched — a refundable volume shed sheds nothing
    await Promise.all([
      deps.redis.del(lockKey).catch(() => undefined),
      deps.redis.eval(DECAY_SCRIPT, 1, failIpKey).catch(() => undefined),
      deps.redis.setex(okIpKey, KNOWN_GOOD_TTL_S, '1').catch(() => undefined),
    ])
    const token = await mintPartnerToken(partner.id, deps.jwtSecret, ttlS)
    c.header('Cache-Control', 'no-store')
    return c.json({ accessToken: token, expiresInS: ttlS })
  })

  // ── PUBLIC: set/reset password via a one-time token ──────────────────────────
  app.post('/v1/partner/set-password', async (c) => {
    if (Number(await deps.redis.eval(RL_SCRIPT, 1, `partner:redeem:${ip(c)}`, String(RL_WINDOW_S))) > REDEEM_RL_MAX) {
      return problem(c, 429, 'Too Many Requests')
    }
    const parsed = partnerSetPasswordSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request', 'invalid token or password')
    const now = new Date()
    // hash BEFORE consuming — the token is single-use, so an argon2 overload (503) after the consume
    // would permanently burn the invite link (parity with /v1/auth/reset-password)
    const newHash = await hashPassword(parsed.data.password)
    const affiliateId = await deps.db.affiliates.consumePwToken(sha256(parsed.data.token), now)
    if (affiliateId === null) return problem(c, 400, 'Bad Request', 'invalid or expired token')
    await deps.db.affiliates.setPassword(affiliateId, newHash)
    // burn any sibling outstanding tokens so only the newest link ever worked (review LOW)
    await deps.db.affiliates.invalidatePwTokens(affiliateId, now)
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true })
  })

  // ── PARTNER-AUTH: the partner's own profile + commissions ────────────────────
  app.get('/v1/partner/me', partnerAuth(deps), (c) => {
    const partner = c.get('partner')
    c.header('Cache-Control', 'no-store')
    // never leak the hash; expose only the partner-facing fields
    return c.json({
      id: partner.id, name: partner.name, email: partner.email, code: partner.code,
      commissionPct: partner.commissionPct.toString(), commissionMonths: partner.commissionMonths,
      status: partner.status, createdAt: partner.createdAt.toISOString(),
    })
  })

  /**
   * The partner's commission ledger — every line traceable back to a customer and an invoice.
   *
   * This used to return an amount, a status and a raw Stripe invoice id, which is a number a partner
   * can neither check nor dispute: "€90, pending" says nothing about who paid, when, or at what rate.
   * Each row now carries the customer, what THEY paid, the rate applied and the resulting commission,
   * so the arithmetic is visible on the page.
   */
  app.get('/v1/partner/commissions', partnerAuth(deps), async (c) => {
    const rows = await deps.db.affiliates.listCommissionsForPartner(c.get('partner').id)
    c.header('Cache-Control', 'no-store')
    return c.json(rows)
  })

  /**
   * The customers this partner introduced.
   *
   * A partner is entitled to know which of their referrals converted, what those customers pay, and
   * when each earning window closes — that is the deal they signed. They are NOT entitled to anything
   * else about that tenant, so the repo selects the company name, plan and subscription state and
   * nothing further: no users, no devices, no contact details.
   */
  app.get('/v1/partner/customers', partnerAuth(deps), async (c) => {
    const rows = await deps.db.affiliates.listReferredCustomers(c.get('partner').id)
    c.header('Cache-Control', 'no-store')
    return c.json(rows)
  })

  return app
}

/** Issue a one-time set/reset-password token for a partner (called by the platform_admin route). The
 *  plaintext is returned ONCE for the admin to convey; only its hash is stored. */
export async function issuePartnerSetPwToken(db: Db, affiliateId: string, ttlS = DEFAULT_SETPW_TTL_S): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  // REPLACE, not create: a second link must retire the first, which is what the admin UI promises
  // and what an admin re-minting to revoke a mis-sent link is relying on.
  await db.affiliates.replacePwToken(affiliateId, sha256(raw), new Date(Date.now() + ttlS * 1000), new Date())
  return raw
}
