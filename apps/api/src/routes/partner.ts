import { createHash, randomBytes } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'
import { partnerLoginSchema, partnerSetPasswordSchema } from '@orbetra/shared'

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
}

// the affiliate row shape, derived from the repo (avoids importing @prisma/client — rule 2)
type Affiliate = NonNullable<Awaited<ReturnType<Db['affiliates']['get']>>>
type PartnerEnv = { Variables: { partner: Affiliate } }

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')
const DEFAULT_TTL_S = 8 * 3_600
const DEFAULT_SETPW_TTL_S = 24 * 3_600
// atomic fixed-window limiter (mirrors login.ts): INCR + re-armed EXPIRE, never strands a TTL-less key
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`
const LOGIN_RL_MAX = 10 // failed logins per IP+email per window
// Same abuse ceilings the tenant login carries (audit MED): the (IP, email) key is different for
// every address tried, so on its own it caps nothing for an attacker willing to vary the email —
// and it gives each source IP its own budget against one partner account.
const LOGIN_RL_MAX_IP = 60 // SOFT: past it a wrong password is refused, a correct one still works
const LOGIN_RL_MAX_IP_HARD = 240 // HARD: past it nothing is verified at all
const LOGIN_RL_MAX_EMAIL = 30 // failed logins against ONE partner account, from anywhere
const REDEEM_RL_MAX = 30 // set-password redeem attempts per IP per window
const RL_WINDOW_S = 3_600
/** One success repays one failure on the per-IP budget, floored at zero (parity with auth/login). */
const DECAY_SCRIPT = `local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n > 0 then redis.call('DECR', KEYS[1]) end
return n`

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
    // lockout gate BEFORE argon2 (attacker-driven CPU cap, parity with tenant login)
    const emailHash = sha256(email).slice(0, 16)
    const lockKey = `partner:fail:${ip(c)}:${emailHash}`
    const ipKey = `partner:fail:ip:${ip(c)}`
    const emailKey = `partner:fail:email:${emailHash}`
    const tooMany = async (key: string): Promise<Response> => {
      const ttl = await deps.redis.ttl(key)
      c.header('Retry-After', String(Math.max(1, ttl)))
      return problem(c, 429, 'Too Many Attempts', 'try again later')
    }
    // Same gate shape, and the same placement rules, as the tenant login — see the long note in
    // `auth/login.ts`. The per-credential rule and the HARD per-IP ceiling shed CPU and so come
    // before argon2; the soft per-IP ceiling and the per-account ceiling are applied only to a wrong
    // password after the verify, because refusing a correct one would lock a named partner out of
    // the portal for a full window. Affiliate emails are the most public identifiers we have, and
    // one IP is a whole office.
    const preGates: [string, number][] = [[lockKey, LOGIN_RL_MAX], [ipKey, LOGIN_RL_MAX_IP_HARD]]
    const preCounts = await deps.redis.mget(...preGates.map(([k]) => k))
    const tripped = preGates.find(([, max], i) => Number(preCounts[i] ?? 0) >= max)
    if (tripped !== undefined) return tooMany(tripped[0])
    const partner = await deps.db.affiliates.findByEmailForAuth(email)
    // constant-ish time: an unknown email / unset password still burns one dummy verify
    const hash = partner?.passwordHash ?? (await DUMMY_HASH_PROMISE)
    const ok = await verifyPassword(hash, parsed.data.password)
    // only an ACTIVE partner with a set password + matching credential may sign in
    if (partner === null || partner.passwordHash === null || !ok || partner.status !== 'active') {
      const bumped = await Promise.all(
        [lockKey, ipKey, emailKey].map((k) => deps.redis.eval(RL_SCRIPT, 1, k, String(RL_WINDOW_S))),
      )
      // `>` not `>=` — the pre-verify gates read before their own increment (see auth/login.ts)
      if (Number(bumped[2] ?? 0) > LOGIN_RL_MAX_EMAIL) return tooMany(emailKey)
      if (Number(bumped[1] ?? 0) > LOGIN_RL_MAX_IP) return tooMany(ipKey)
      return problem(c, 401, 'Unauthorized', 'invalid credentials')
    }
    // identity-scoped counters cleared outright; the per-IP budget only DECAYS by one, so a
    // successful login cannot refund a whole attack budget while a shared egress still recovers
    await Promise.all([deps.redis.del(lockKey, emailKey), deps.redis.eval(DECAY_SCRIPT, 1, ipKey)])
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

  app.get('/v1/partner/commissions', partnerAuth(deps), async (c) => {
    const rows = await deps.db.affiliates.listCommissions(c.get('partner').id)
    c.header('Cache-Control', 'no-store')
    return c.json(rows.map((r) => ({
      id: r.id, amountCents: r.amountCents, currency: r.currency, status: r.status,
      sourceInvoiceId: r.sourceInvoiceId, createdAt: r.createdAt.toISOString(),
    })))
  })

  return app
}

/** Issue a one-time set/reset-password token for a partner (called by the platform_admin route). The
 *  plaintext is returned ONCE for the admin to convey; only its hash is stored. */
export async function issuePartnerSetPwToken(db: Db, affiliateId: string, ttlS = DEFAULT_SETPW_TTL_S): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  await db.affiliates.createPwToken(affiliateId, sha256(raw), new Date(Date.now() + ttlS * 1000))
  return raw
}
