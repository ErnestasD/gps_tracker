import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Redis } from 'ioredis'

import type { AuthDb, AuthUserRow } from '@orbetra/db'
import { forgotPasswordSchema, loginRequestSchema, passwordChangeSchema, planEntitlements, resetPasswordSchema, type AuthSession, type AuthUser } from '@orbetra/shared'

import { mintAccessToken } from './jwt.js'
import { authMiddleware, problem, type AuthEnv } from './middleware.js'
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from './passwords.js'
import { revokeAllUserSessions } from './revoke.js'
import { markSessionsRevoked } from '../ws.js'
import { clientIp } from '../net.js'

/**
 * CSRF defence for the cookie-bearing auth POSTs (audit LOW). The refresh cookie is the
 * capability; a cross-site page must not be able to drive login (session fixation) / refresh /
 * logout / password with it. The refresh cookie is already SameSite=Strict (the primary CSRF
 * defense — a cross-site POST never carries it); this Origin check is defense-in-depth.
 *
 * A browser Origin/Referer is accepted when it matches the request's OWN host (app + API
 * same-origin behind Caddy — the production topology) OR any host in AUTH_TRUSTED_ORIGINS
 * (comma-separated hosts; for split-host deployments and the e2e harness where the SPA and API
 * are served on different ports). A non-browser client (no Origin/Referer) is allowed — cookie
 * CSRF requires a browser, which always sends an Origin on a cross-site POST.
 */
const TRUSTED_ORIGIN_HOSTS = new Set(
  (process.env['AUTH_TRUSTED_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== ''),
)
function sameOriginOk(c: Context): boolean {
  const host = (c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '').split(',')[0]!.trim().toLowerCase()
  const check = (raw: string | undefined): boolean | null => {
    if (raw === undefined || raw === '' || raw === 'null') return null
    try {
      const oh = new URL(raw).host.toLowerCase()
      return oh === host || TRUSTED_ORIGIN_HOSTS.has(oh)
    } catch {
      return false
    }
  }
  const byOrigin = check(c.req.header('origin'))
  if (byOrigin !== null) return byOrigin
  const byReferer = check(c.req.header('referer'))
  if (byReferer !== null) return byReferer
  return true
}

export interface AuthRouteDeps {
  /** The auth surface (createDb().auth or createAuthDb()); $disconnect not needed. */
  db: Omit<AuthDb, '$disconnect'>
  redis: Redis
  jwtSecret: string
  jwtTtlS: number
  refreshTtlS: number
  lockout: { maxFails: number; windowS: number }
  secureCookies: boolean
  /** Trust X-Forwarded-For (prod behind Caddy only). */
  trustProxy: boolean
  /** Password-reset token lifetime (ADR-031); default 3600 s (1 h). */
  resetTokenTtlS?: number
  /** Absolute base URL the reset link is built from (APP_BASE_URL). Absent ⇒ forgot-password still
   *  answers 200 (no enumeration) but sends nothing (email link can't be built). */
  appBaseUrl?: string
  /** Transactional auth-email enqueuer (ADR-031) — the API can't send email, so it hands the branded
   *  send to the worker's `auth-email` queue. Absent ⇒ forgot-password is a no-op (still 200). */
  mail?: {
    enqueueResetEmail(job: {
      kind: 'password-reset'
      email: string
      tenantId: string
      locale: string
      resetUrl: string
      expiresMinutes: number
    }): Promise<void>
  }
}

const COOKIE = 'orb_refresh'
const COOKIE_PATH = '/v1/auth' // the cookie never rides on data requests

const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')

// atomic fixed-window bump (mirrors caddyAsk RL_SCRIPT): INCR, set TTL on the first hit OR re-arm
// a stranded TTL-less key — a failed one-shot EXPIRE must never leave a key that 429s forever
// (review LOW-2: a Redis blip between INCR and EXPIRE would else permanently lock an IP+email pair)
const LOCKOUT_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

// forgot-password rate limit (ADR-031): max reset requests per IP+email per window. Generous enough
// for a real user retrying, tight enough that the send path can't mail-bomb or probe for accounts.
const RESET_RL_MAX = 5
const RESET_REDEEM_RL_MAX = 30 // redeem attempts per IP per window (token guessing is infeasible; this caps floods)
const RESET_RL_WINDOW_S = 3_600
const DEFAULT_RESET_TTL_S = 3_600 // reset link lifetime (1 h)


const toAuthUser = (u: AuthUserRow): AuthUser => ({
  id: u.id,
  email: u.email,
  role: u.role,
  tenantId: u.tenantId,
  accountId: u.accountId,
  locale: u.locale,
  // entitlements are computed ONCE, server-side, from the tenant plan carried on the row — the web
  // reads these gates and never derives them itself (single source: planEntitlements).
  plan: u.plan,
  entitlements: planEntitlements(u.plan),
})

/**
 * POST /v1/auth/login|refresh|logout + GET /v1/auth/me (E03-1, §6.6).
 * Refresh tokens: opaque 32B CSPRNG values, sha256-stored, rotating families —
 * reuse of a rotated token revokes the whole family (AC[1]). Lockout runs BEFORE
 * any argon2 work (attacker-driven CPU cap, §6.1: 5 fails → 15 min per IP+email).
 */
export function createAuthRoutes(deps: AuthRouteDeps, getRemoteAddr: (c: unknown) => string): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>()

  const setRefreshCookie = (c: Context, raw: string) =>
    setCookie(c, COOKIE, raw, {
      httpOnly: true,
      sameSite: 'Strict',
      path: COOKIE_PATH,
      maxAge: deps.refreshTtlS,
      secure: deps.secureCookies,
    })

  const issueSession = async (user: AuthUserRow, familyId: string): Promise<{ session: AuthSession; rawRefresh: string }> => {
    const rawRefresh = randomBytes(32).toString('hex')
    await deps.db.refreshTokens.create({
      id: randomUUID(),
      familyId,
      userId: user.id,
      tokenHash: sha256(rawRefresh),
      expiresAt: new Date(Date.now() + deps.refreshTtlS * 1000),
    })
    const accessToken = await mintAccessToken(
      {
        sub: user.id,
        ten: user.tenantId,
        ...(user.accountId !== null ? { acc: user.accountId } : {}),
        role: user.role,
      },
      deps.jwtSecret,
      deps.jwtTtlS,
    )
    return { session: { accessToken, expiresInS: deps.jwtTtlS, user: toAuthUser(user) }, rawRefresh }
  }

  app.post('/login', async (c) => {
    if (!sameOriginOk(c)) return problem(c, 403, 'Forbidden', 'cross-origin request rejected')
    const body = loginRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return problem(c, 400, 'Bad Request', 'email and password required')
    const email = body.data.email.trim().toLowerCase()
    const ip = clientIp(c.req.header('x-forwarded-for'), getRemoteAddr(c), deps.trustProxy)

    // lockout gate BEFORE any DB/argon2 work (§6.1: 5 fails → 15 min per IP+email)
    const lockKey = `auth:fail:${ip}:${sha256(email).slice(0, 16)}`
    const fails = Number((await deps.redis.get(lockKey)) ?? 0)
    if (fails >= deps.lockout.maxFails) {
      const ttl = await deps.redis.ttl(lockKey)
      c.header('Retry-After', String(Math.max(1, ttl)))
      return problem(c, 429, 'Too Many Attempts', 'try again later')
    }

    // verify against ALL candidates, no short-circuit; unknown email burns one
    // dummy verify — response timing must not reveal email existence
    const candidates = await deps.db.users.findByEmailAllTenants(email)
    const verified: AuthUserRow[] = []
    if (candidates.length === 0) {
      await verifyPassword(await DUMMY_HASH_PROMISE, body.data.password)
    } else {
      for (const u of candidates) {
        if (await verifyPassword(u.passwordHash, body.data.password)) verified.push(u)
      }
    }

    if (verified.length === 0) {
      // atomic INCR + (re-armed) EXPIRE — never strands a TTL-less key (review LOW-2)
      await deps.redis.eval(LOCKOUT_SCRIPT, 1, lockKey, String(deps.lockout.windowS))
      return problem(c, 401, 'Unauthorized', 'invalid credentials')
    }
    if (verified.length > 1) {
      // same email+password verifying in MULTIPLE tenants (founder decision
      // 2026-07-07): never guess the tenant. E03-5 host-based tenant resolution
      // deletes this branch. Only a valid credential holder can see this.
      return problem(c, 409, 'Ambiguous Identity', 'contact your administrator', 'https://orbetra.dev/problems/ambiguous-identity')
    }

    await deps.redis.del(lockKey) // success resets the counter
    const user = verified[0]!
    const { session, rawRefresh } = await issueSession(user, randomUUID())
    setRefreshCookie(c, rawRefresh)
    c.header('Cache-Control', 'no-store')
    return c.json(session)
  })

  app.post('/refresh', async (c) => {
    if (!sameOriginOk(c)) return problem(c, 403, 'Forbidden', 'cross-origin request rejected')
    const raw = getCookie(c, COOKIE)
    if (raw === undefined || raw === '') return problem(c, 401, 'Unauthorized')
    const now = new Date()
    const claimed = await deps.db.refreshTokens.claimForRotation(sha256(raw), now)
    if (claimed === null) {
      const row = await deps.db.refreshTokens.findByTokenHash(sha256(raw))
      if (row && (row.rotatedAt !== null || row.revokedAt !== null)) {
        // REUSE of a consumed token (AC[1]): the token leaked or a race lost —
        // kill the entire family; every sibling session must re-authenticate
        await deps.db.refreshTokens.revokeFamily(row.familyId, now)
      }
      deleteCookie(c, COOKIE, { path: COOKIE_PATH })
      return problem(c, 401, 'Unauthorized')
    }
    const user = await deps.db.users.findByIdForAuth(claimed.userId)
    if (user === null) {
      await deps.db.refreshTokens.revokeFamily(claimed.familyId, now)
      deleteCookie(c, COOKIE, { path: COOKIE_PATH })
      return problem(c, 401, 'Unauthorized')
    }
    // fresh user read ⇒ role/account changes propagate within one access-token TTL
    const { session, rawRefresh } = await issueSession(user, claimed.familyId)
    setRefreshCookie(c, rawRefresh)
    c.header('Cache-Control', 'no-store')
    return c.json(session)
  })

  app.post('/logout', async (c) => {
    if (!sameOriginOk(c)) return problem(c, 403, 'Forbidden', 'cross-origin request rejected')
    // clear the cookie UNCONDITIONALLY first (review LOW: a revoke throw must not
    // leave a live cookie while the SPA believes it logged out)
    deleteCookie(c, COOKIE, { path: COOKIE_PATH })
    const raw = getCookie(c, COOKIE)
    if (raw !== undefined && raw !== '') {
      try {
        const row = await deps.db.refreshTokens.findByTokenHash(sha256(raw))
        if (row) {
          await deps.db.refreshTokens.revokeFamily(row.familyId, new Date())
          // …and tear down any LIVE WS stream this user holds — without this a socket opened before
          // logout keeps streaming positions past it (audit R2-5). Marks by userId: a still-valid
          // session on another device simply reconnects with a fresh ticket (self-healing blip).
          await markSessionsRevoked(deps.redis, row.userId)
        }
      } catch {
        // best-effort server revoke; the cookie is already cleared
      }
    }
    return c.json({ ok: true })
  })

  // identity after reload-refresh (web needs it; all roles)
  app.get('/me', authMiddleware({ jwtSecret: deps.jwtSecret }), async (c) => {
    const auth = c.get('auth')
    const user = await deps.db.users.findByIdForAuth(auth.userId)
    if (user === null) return problem(c, 401, 'Unauthorized')
    c.header('Cache-Control', 'no-store')
    return c.json(toAuthUser(user))
  })

  // self-service password change (E03-2, Settings/Profile). Verify current, set new, then revoke
  // ALL of the user's refresh families so EVERY other session must re-login (review HIGH: a stolen
  // session must not outlive a password change).
  app.post('/password', authMiddleware({ jwtSecret: deps.jwtSecret }), async (c) => {
    if (!sameOriginOk(c)) return problem(c, 403, 'Forbidden', 'cross-origin request rejected')
    const parsed = passwordChangeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request')
    const auth = c.get('auth')
    const user = await deps.db.users.findByIdForAuth(auth.userId)
    if (user === null) return problem(c, 401, 'Unauthorized')
    if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
      return problem(c, 401, 'Unauthorized', 'current password is wrong')
    }
    await deps.db.users.setPassword(user.id, await hashPassword(parsed.data.newPassword))
    // revoke EVERY family for this user (all sessions). The current cookie's family is the
    // fallback used until packages/db ships refreshTokens.revokeAllForUser (see revoke.ts TODO).
    const raw = getCookie(c, COOKIE)
    let currentFamily: string | undefined
    if (raw !== undefined && raw !== '') {
      const row = await deps.db.refreshTokens.findByTokenHash(sha256(raw))
      currentFamily = row?.familyId
    }
    await revokeAllUserSessions(deps.db.refreshTokens, user.id, currentFamily)
    // …and tear down any LIVE WebSocket stream this user holds — a socket opened before the
    // change would otherwise keep streaming positions past the password change (audit MED).
    await markSessionsRevoked(deps.redis, user.id)
    deleteCookie(c, COOKIE, { path: COOKIE_PATH })
    return c.json({ ok: true })
  })

  // ── forgot password (ADR-031) ──────────────────────────────────────────────
  // Step 1: request a reset link. ALWAYS answers 200 with the same body — existence of the email is
  // never revealed (no enumeration). Rate-limited per IP+email so the send path can't spam a mailbox
  // or probe for accounts. The actual send is handed to the worker (auth-email queue); a missing
  // transport / APP_BASE_URL degrades to "nothing sent", still 200.
  app.post('/forgot-password', async (c) => {
    if (!sameOriginOk(c)) return problem(c, 403, 'Forbidden', 'cross-origin request rejected')
    const body = forgotPasswordSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return problem(c, 400, 'Bad Request', 'email required')
    const email = body.data.email.trim().toLowerCase()
    const ip = clientIp(c.req.header('x-forwarded-for'), getRemoteAddr(c), deps.trustProxy)
    c.header('Cache-Control', 'no-store')

    // atomic per IP+email rate limit — over the cap we STILL return the generic 200 (no signal) but
    // do no work, so a flood can neither mail-bomb a victim nor time-probe for account existence.
    const rlKey = `auth:reset:${ip}:${sha256(email).slice(0, 16)}`
    const attempts = Number(await deps.redis.eval(LOCKOUT_SCRIPT, 1, rlKey, String(RESET_RL_WINDOW_S)))
    if (attempts > RESET_RL_MAX) return c.json({ ok: true })

    if (deps.mail !== undefined && deps.appBaseUrl !== undefined) {
      const ttlS = deps.resetTokenTtlS ?? DEFAULT_RESET_TTL_S
      const base = deps.appBaseUrl.replace(/\/+$/, '')
      const users = await deps.db.users.findByEmailAllTenants(email)
      // timing-enumeration defense (parity with login's dummy verifyPassword): the miss path must
      // burn work comparable to a single mint (crypto + a DB write round-trip) so hit/miss latency
      // distributions match — an UPDATE on a random userId touches 0 rows at ~the same cost.
      if (users.length === 0) {
        sha256(randomBytes(32).toString('hex'))
        await deps.db.passwordResetTokens.invalidateAllForUser(randomUUID(), new Date()).catch(() => undefined)
      }
      // an email may exist in >1 tenant (ambiguous identity) — mint + mail one per tenant so the
      // right branded link reaches the user; each token is independent + single-use.
      for (const u of users) {
        try {
          await deps.db.passwordResetTokens.invalidateAllForUser(u.id, new Date()) // only the newest link stays valid
          const rawToken = randomBytes(32).toString('hex')
          await deps.db.passwordResetTokens.create({
            id: randomUUID(),
            userId: u.id,
            tokenHash: sha256(rawToken),
            expiresAt: new Date(Date.now() + ttlS * 1000),
          })
          await deps.mail.enqueueResetEmail({
            kind: 'password-reset',
            email: u.email,
            tenantId: u.tenantId,
            locale: u.locale,
            resetUrl: `${base}/reset-password?token=${rawToken}`,
            expiresMinutes: Math.round(ttlS / 60),
          })
        } catch (err) {
          // one candidate's failure must not reveal (via a 500) that the email exists — log + continue
          console.error('forgot-password send failed', err instanceof Error ? err.message : String(err))
        }
      }
    }
    return c.json({ ok: true })
  })

  // Step 2: redeem the token + set the new password. The token is consumed atomically (single-use);
  // an invalid/expired/used token is a flat 400 with no detail. A successful reset revokes EVERY
  // session (refresh families + live WS) so a stolen/other session cannot outlive the reset.
  app.post('/reset-password', async (c) => {
    if (!sameOriginOk(c)) return problem(c, 403, 'Forbidden', 'cross-origin request rejected')
    // belt-and-suspenders per-IP throttle on the redeem endpoint (token guessing is already
    // infeasible at 256-bit, but this caps DB-write abuse / brute-force floods)
    const ip = clientIp(c.req.header('x-forwarded-for'), getRemoteAddr(c), deps.trustProxy)
    if (Number(await deps.redis.eval(LOCKOUT_SCRIPT, 1, `auth:redeem:${ip}`, String(RESET_RL_WINDOW_S))) > RESET_REDEEM_RL_MAX) {
      return problem(c, 429, 'Too Many Requests')
    }
    const body = resetPasswordSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return problem(c, 400, 'Bad Request', 'invalid token or password')
    const now = new Date()
    const consumed = await deps.db.passwordResetTokens.consume(sha256(body.data.token), now)
    if (consumed === null) return problem(c, 400, 'Bad Request', 'invalid or expired token')
    const user = await deps.db.users.findByIdForAuth(consumed.userId)
    if (user === null) return problem(c, 400, 'Bad Request', 'invalid or expired token')
    await deps.db.users.setPassword(user.id, await hashPassword(body.data.newPassword))
    await deps.db.passwordResetTokens.invalidateAllForUser(user.id, now) // burn any sibling tokens
    // kill every session: all refresh families + any live WS stream (parity with password change)
    await revokeAllUserSessions(deps.db.refreshTokens, user.id)
    await markSessionsRevoked(deps.redis, user.id)
    deleteCookie(c, COOKIE, { path: COOKIE_PATH })
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true })
  })

  return app
}
