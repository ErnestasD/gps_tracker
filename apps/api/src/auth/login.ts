import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Redis } from 'ioredis'

import type { AuthDb, AuthUserRow } from '@orbetra/db'
import { effectiveEntitlementsAt, forgotPasswordSchema, localeUpdateSchema, loginRequestSchema, passwordChangeSchema, resetPasswordSchema, type AuthSession, type AuthUser } from '@orbetra/shared'

import { mintAccessToken } from './jwt.js'
import { authMiddleware, problem, type AuthEnv } from './middleware.js'
import { count, gateRead, ADMIT_SCRIPT, DECAY_SCRIPT, FAIL_SOURCE_SCRIPT, KNOWN_GOOD_TTL_S, LOCKOUT_SCRIPT, UNMARKED_ADMIT_EVERY } from './gates.js'
import { fixedWindowCount } from '../security.js'
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
  /**
   * Failed-login ceilings inside `windowS`. `maxFails` is the documented per (IP, email) rule;
   * the other two close the holes that key shape leaves open — one IP varying the email, and many
   * IPs stuffing one account. Defaults derive from maxFails so a deployment that only sets it
   * still gets all three.
   */
  lockout: {
    maxFails: number
    windowS: number
    /** Soft per-IP ceiling on FAILURES: past it a wrong password is refused, a correct one is not. */
    maxFailsPerIp?: number
    /** Hard per-IP ceiling on ATTEMPTS (successes included): past it nothing is verified at all. */
    maxAttemptsPerIpHard?: number
    /** Distinct source IPs that may fail against ONE account before it is locked for the window. */
    maxFailIpsPerEmail?: number
  }
  /** A lockout gate refused a request, by which ceiling tripped. A customer locked out of the
   *  product must be visible in Grafana, not merely in their own support ticket. */
  onLockout?: (gate: 'credential' | 'ip' | 'email' | 'degraded') => void
  /** a login presented the RIGHT password for an account whose address was never verified. Invisible
   *  in the response by design, so this counter is the only way to see people stuck at that gate. */
  onUnverifiedLogin?: () => void
  /** Self-service password-change limit per user; default 10/h. Two argon2 ops per request. */
  passwordChangeRateLimit?: { max: number; windowS: number }
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
  // UI hint only: the plan matrix the web reads to show/hide nav. The AUTHORITATIVE gate is
  // server-side and subscription-status-aware (auth/entitlements.ts + the device-cap checks use
  // db.tenants.getEntitlements) — a lapsed tenant is denied there even though this hint stays
  // plan-based (loading live billing status into a sync row-mapper isn't worth it; worst case the
  // web shows an item that then 403s with plan_upgrade_required).
  plan: u.plan,
  // TRIAL-AWARE hint: the same helper the authoritative server gate uses, so an expired self-serve
  // trial (or a lapsed subscription) never advertises a feature the API would then 403.
  entitlements: effectiveEntitlementsAt(u.plan, u.subscriptionStatus, u.currentPeriodEnd, u.stripeSubscriptionId),
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

  /** Access token only — the refresh row is written by the caller (login creates, refresh rotates). */
  const mintSession = async (user: AuthUserRow): Promise<AuthSession> => {
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
    return { accessToken, expiresInS: deps.jwtTtlS, user: toAuthUser(user) }
  }

  const newRefresh = (): { raw: string; id: string; tokenHash: string; expiresAt: Date } => {
    const raw = randomBytes(32).toString('hex')
    return { raw, id: randomUUID(), tokenHash: sha256(raw), expiresAt: new Date(Date.now() + deps.refreshTtlS * 1000) }
  }

  const issueSession = async (user: AuthUserRow, familyId: string): Promise<{ session: AuthSession; rawRefresh: string }> => {
    const next = newRefresh()
    await deps.db.refreshTokens.create({ id: next.id, familyId, userId: user.id, tokenHash: next.tokenHash, expiresAt: next.expiresAt })
    return { session: await mintSession(user), rawRefresh: next.raw }
  }

  app.post('/login', async (c) => {
    if (!sameOriginOk(c)) return problem(c, 403, 'Forbidden', 'cross-origin request rejected')
    const body = loginRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return problem(c, 400, 'Bad Request', 'email and password required')
    const email = body.data.email.trim().toLowerCase()
    const ip = clientIp(c.req.header('x-forwarded-for'), getRemoteAddr(c), deps.trustProxy)

    // Lockout gates. THREE counters, because the original single (IP, email) key left two holes
    // open (audit MED) — but they do NOT all gate at the same point, and that distinction is the
    // whole design:
    //
    //  - per (IP, email) at `maxFails` — the documented §6.1 rule. INCREMENTED BEFORE the verify
    //    and gated on the returned count, not read-then-written around a ~120 ms argon2 call: with
    //    a check-then-act gate every concurrent request reads the same pre-increment value, so the
    //    real bound was the argon2 admission queue (8 running + 64 waiting = 72 per replica), not
    //    five. It is deleted on success, so a legitimate user is never affected by counting
    //    attempts rather than failures.
    //  - per IP, in TWO tiers, on TWO different keys. One IP is not one person: a corporate NAT or
    //    a carrier CGNAT is hundreds of people behind one address. The HARD ceiling counts EVERY
    //    ATTEMPT (`auth:attempt:ip:`), never decays, and is applied pre-verify: it is the CPU shed,
    //    and it must not be refundable. Sharing one key with the soft tier made it exactly that —
    //    one free signup, and an attacker who interleaved a login to their own account held the
    //    counter near zero forever, buying unlimited argon2 from a single address.
    //
    //    The SOFT ceiling counts FAILURES (`auth:fail:ip:`) and decays by one per success. Applied
    //    only post-verify it enforced NOTHING — a correct password never reaches the check, so it
    //    merely relabelled a wrong guess 401→429 while a full argon2 verify ran anyway, leaving
    //    both the oracle and the CPU cost intact. Applied pre-verify it locks out a whole office
    //    behind one NAT, with no way back, because the successful login that would repay the budget
    //    is refused by the gate it would clear. So it is pre-verify ONLY for a bucket that has
    //    never produced a successful login: a source we have never seen a real user come from is
    //    refused once it has spent its failures, and a source that has is throttled but never
    //    denied. An attacker can buy "known good" with one account of their own — and is then still
    //    bounded by the hard ceiling, which no success ever refunds.
    //  - per ACCOUNT, counted as DISTINCT SOURCE IPs that have failed against it, pre-verify.
    //    Counting failed ATTEMPTS instead does not work, in either placement. Pre-verify it is an
    //    account-lockout weapon: emails are enumerable (admins, support addresses, and every
    //    affiliate address is published), so ~20 wrong guesses from ONE host denied any named
    //    customer their own product for a full window. Post-verify it bounds nothing at all: the
    //    check only runs on the failure path, so a CORRECT password sails through and the
    //    attacker's oracle — 200 means right, anything else means wrong — is untouched; it merely
    //    relabels a wrong guess from 401 to 429 while argon2 still runs on every attempt.
    //    Distinct IPs is the axis the threat actually lives on: a real user fails from one or two
    //    addresses, distributed stuffing needs many. This IS a lockout — the owner cannot sign in
    //    while it holds — and that is a deliberate, metered trade-off: it takes a botnet of
    //    `maxFailIpsPerEmail` distinct hosts to trigger, which is precisely the case where refusing
    //    everyone is the correct answer, and the ceiling is env-tunable so it can be raised live.
    const emailHash = sha256(email).slice(0, 16)
    const lockKey = `auth:fail:${ip}:${emailHash}`
    const failIpKey = `auth:fail:ip:${ip}`
    const attemptIpKey = `auth:attempt:ip:${ip}`
    const emailIpsKey = `auth:fail:ips:${emailHash}` // HyperLogLog: bounded 12 KB whatever the botnet size
    const okIpKey = `auth:ok:ip:${ip}` // "a real user has signed in from this bucket recently"
    const maxFailIpsPerEmail = deps.lockout.maxFailIpsPerEmail ?? 30
    const maxPerIp = deps.lockout.maxFailsPerIp ?? deps.lockout.maxFails * 10
    const maxAttemptsPerIpHard = deps.lockout.maxAttemptsPerIpHard ?? maxPerIp * 20
    const windowS = String(deps.lockout.windowS)
    const tooMany = async (key: string, gate: 'credential' | 'ip' | 'email'): Promise<Response> => {
      deps.onLockout?.(gate)
      // the whole point of this path is to degrade gracefully — a Redis hiccup while reading a TTL
      // must not turn the 429 into a 500
      const ttl = await deps.redis.ttl(key).catch(() => deps.lockout.windowS)
      c.header('Retry-After', String(Math.max(1, ttl)))
      return problem(c, 429, 'Too Many Attempts', 'try again later')
    }

    // read-only pre-checks first: a request refused here costs one pipeline and no argon2, and must
    // not add to the very counters that refused it (that would extend a lockout for free)
    const pre = await gateRead(deps, () =>
      deps.redis.pipeline().get(attemptIpKey).pfcount(emailIpsKey).get(failIpKey).exists(okIpKey).exec(),
    )
    // `pre === null` means a gate could not be evaluated — skip ALL of them rather than reading the
    // absent values as zero. Reading them would also invert the fail-open posture for a deployment
    // that sets a ceiling to 0: `0 >= 0` refuses every login precisely when Redis is degraded.
    if (pre !== null) {
      if (count(pre[0]) >= maxAttemptsPerIpHard) return tooMany(attemptIpKey, 'ip')
      if (count(pre[1]) >= maxFailIpsPerEmail) return tooMany(emailIpsKey, 'email')
      // Soft ceiling on an UNMARKED bucket: throttle to one attempt in N rather than refuse. See
      // UNMARKED_ADMIT_EVERY — a hard refusal here is a renewable lockout for a whole shared egress,
      // because the login that would mark the bucket is itself refused.
      if (count(pre[2]) >= maxPerIp && count(pre[3]) === 0) {
        const admitted = await gateRead(deps, () =>
          deps.redis
            .pipeline()
            .eval(ADMIT_SCRIPT, 1, `auth:admit:ip:${ip}`, String(UNMARKED_ADMIT_EVERY), windowS)
            .exec(),
        )
        if (admitted !== null && count(admitted[0]) === 0) return tooMany(failIpKey, 'ip')
      }
    }

    // then the per-credential rule, incremented and gated on the SAME atomic result. The attempt
    // counter is bumped here too and re-checked: the read above lets a spent budget drain (a
    // refused request must not extend its own lockout), while this catches a concurrent burst that
    // all read the same sub-ceiling value.
    const bumped = await gateRead(deps, () =>
      deps.redis
        .pipeline()
        .eval(LOCKOUT_SCRIPT, 1, lockKey, windowS)
        .eval(LOCKOUT_SCRIPT, 1, attemptIpKey, windowS)
        .exec(),
    )
    if (bumped !== null) {
      if (count(bumped[0]) > deps.lockout.maxFails) return tooMany(lockKey, 'credential')
      if (count(bumped[1]) > maxAttemptsPerIpHard) return tooMany(attemptIpKey, 'ip')
    }

    // verify against ALL candidates, no short-circuit; unknown email burns one
    // dummy verify — response timing must not reveal email existence
    const candidates = await deps.db.users.findByEmailAllTenants(email)
    const verified: AuthUserRow[] = []
    try {
      if (candidates.length === 0) {
        await verifyPassword(await DUMMY_HASH_PROMISE, body.data.password)
      } else {
        for (const u of candidates) {
          if (await verifyPassword(u.passwordHash, body.data.password)) verified.push(u)
        }
      }
    } catch (err) {
      // An argon2 shed (503) means no password was ever compared — so the two counters bumped above
      // must be REFUNDED. Without this a CPU spike converts into a lockout for people who typed the
      // right password all along: five sheds and the sixth attempt is 429 for the rest of the
      // window. The user never got it wrong; the server was busy.
      await Promise.all([
        deps.redis.eval(DECAY_SCRIPT, 1, lockKey).catch(() => undefined),
        deps.redis.eval(DECAY_SCRIPT, 1, attemptIpKey).catch(() => undefined),
      ])
      throw err
    }

    // UNVERIFIED accounts are folded into the wrong-password branch — same 401, same body, same
    // lockout bookkeeping, same latency (the argon2 verify above has already run). This is what
    // finally closes the signup oracle (audit MED #67): answering a taken address with the same 201
    // as a free one only moved the question one request downstream, because the free branch handed
    // back an account the caller could then log into. It cannot now.
    //
    // Folding it in rather than returning a distinct "verify your email" is deliberate and costs
    // real UX: a legitimate user who has not clicked the link sees "invalid credentials". Any
    // distinguishable answer here — a different status, a different body, a skipped lockout
    // increment that shows up as a later 429 — reopens the oracle for the price of one extra
    // request. The login screen tells everyone to check their mail on a failed attempt, and
    // `POST /v1/public/verify-email/resend` is one click away, which is where that cost is paid back.
    const unverified = verified.filter((u) => u.emailVerifiedAt === null)
    if (unverified.length > 0 && unverified.length === verified.length) {
      deps.onUnverifiedLogin?.()
      verified.length = 0
    } else if (unverified.length > 0) {
      // the same address verified in several tenants, only some of them proven: sign in to the
      // proven ones and leave the rest invisible
      const proven = verified.filter((u) => u.emailVerifiedAt !== null)
      verified.length = 0
      verified.push(...proven)
    }

    if (verified.length === 0) {
      // atomic INCR + (re-armed) EXPIRE — never strands a TTL-less key (review LOW-2). PFADD marks
      // this source against the account; its TTL is re-armed the same way for the same reason.
      const failed = await gateRead(deps, () =>
        deps.redis
          .pipeline()
          .eval(LOCKOUT_SCRIPT, 1, failIpKey, windowS)
          .eval(FAIL_SOURCE_SCRIPT, 1, emailIpsKey, ip, windowS)
          .exec(),
      )
      // For a KNOWN-GOOD bucket the soft ceiling only ever gets this far, and here it can do no
      // more than relabel the answer — the office is throttled, never denied. Unknown buckets were
      // already refused pre-verify above, before any argon2 ran.
      if (failed !== null && count(failed[0]) > maxPerIp) return tooMany(failIpKey, 'ip')
      return problem(c, 401, 'Unauthorized', 'invalid credentials')
    }
    if (verified.length > 1) {
      // same email+password verifying in MULTIPLE tenants (founder decision
      // 2026-07-07): never guess the tenant. E03-5 host-based tenant resolution
      // deletes this branch. Only a valid credential holder can see this.
      return problem(c, 409, 'Ambiguous Identity', 'contact your administrator', 'https://orbetra.dev/problems/ambiguous-identity')
    }

    // Success clears the per-credential counter outright. The per-IP FAILURE budget is only
    // DECREMENTED: clearing it would let an attacker refund it by interleaving one login to an
    // account they control, while never decaying it punishes a shared egress. One failure costs one
    // success to undo. The per-IP ATTEMPT counter is deliberately untouched — it is a volume shed,
    // and a refundable volume shed sheds nothing. The account's distinct-IP set is also untouched:
    // an attack in progress is not over because one person got in.
    // guarded like every other Redis touch on this path: these are bookkeeping, and a write error
    // (-MISCONF after a failed BGSAVE, -OOM, -READONLY on a replica) must not turn a CORRECT
    // password into a 500. `onError` has no branch for it, so it would be a flat Internal Error.
    await Promise.all([
      deps.redis.del(lockKey).catch(() => undefined),
      deps.redis.eval(DECAY_SCRIPT, 1, failIpKey).catch(() => undefined),
      // remember this bucket as a source that has produced a real login — see the soft-ceiling note
      deps.redis.setex(okIpKey, KNOWN_GOOD_TTL_S, '1').catch(() => undefined),
    ])
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
    const next = newRefresh()
    // ONE transaction: claim → lock the owning user → refuse if the token predates that user's
    // session epoch → insert the successor (packages/db `rotate`). Doing this as separate statements
    // is what let a refresh IN FLIGHT during a password reset resurrect the family — every eviction
    // path is `updateMany WHERE revokedAt IS NULL`, which cannot match a row inserted after it ran,
    // and a plain re-read afterwards is a snapshot that cannot see an UNCOMMITTED eviction either.
    // The `FOR UPDATE` on the user row is the serialization point (audit high + review high).
    const claimed = await deps.db.refreshTokens.rotate(sha256(raw), now, next)
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
    const session = await mintSession(user)
    const rawRefresh = next.raw

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

  // self-service profile update (any authenticated user): persist the UI language to the user's
  // record so it follows them across devices and the server can localize their emails/reports.
  // Locale-only for now (theme stays client-local); the userId is the verified token's, never a param.
  app.patch('/me', authMiddleware({ jwtSecret: deps.jwtSecret }), async (c) => {
    if (!sameOriginOk(c)) return problem(c, 403, 'Forbidden', 'cross-origin request rejected')
    const parsed = localeUpdateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request')
    const auth = c.get('auth')
    await deps.db.users.setLocale(auth.userId, parsed.data.locale)
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
    // TWO 64 MB argon2 operations per request (verify current + hash new) behind nothing but a
    // valid access token: any authenticated user of any tenant could saturate the process-wide
    // 8-slot semaphore from one session, which sheds 503s across every login on the platform. The
    // login route's own ceilings do not cover this one, so it carries its own — per user, because
    // that is the identity the token already pins. Fails open like every other limiter.
    const pwRl = deps.passwordChangeRateLimit ?? { max: 10, windowS: 3_600 }
    if ((await fixedWindowCount(deps.redis, `auth:pwchange:${auth.userId}`, pwRl.windowS, () => deps.onLockout?.('degraded'))) > pwRl.max) {
      c.header('Retry-After', String(pwRl.windowS))
      return problem(c, 429, 'Too Many Requests')
    }
    const user = await deps.db.users.findByIdForAuth(auth.userId)
    if (user === null) return problem(c, 401, 'Unauthorized')
    if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
      return problem(c, 401, 'Unauthorized', 'current password is wrong')
    }
    await deps.db.users.setPassword(user.id, await hashPassword(parsed.data.newPassword))
    // revoke EVERY family for this user (all sessions). The current cookie's family is the
    // fallback used via refreshTokens.revokeAllForUser, which sweeps the rows AND stamps the session epoch.
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
    // hash BEFORE consuming: the token is single-use and consumed ATOMICALLY, so hashing afterwards
    // meant an argon2 overload (503) burned the reset link permanently — under exactly the load
    // spike where the user retries. Wasted work on an invalid token is the cheaper failure.
    const newHash = await hashPassword(body.data.newPassword)
    const consumed = await deps.db.passwordResetTokens.consume(sha256(body.data.token), now)
    if (consumed === null) return problem(c, 400, 'Bad Request', 'invalid or expired token')
    const user = await deps.db.users.findByIdForAuth(consumed.userId)
    if (user === null) return problem(c, 400, 'Bad Request', 'invalid or expired token')
    // Revocation BRACKETS the password write (audit MED + review).
    //
    // The point of a reset is usually that someone else is in the account. Revoking only AFTER the
    // write meant a failure there left the victim's password changed and the attacker's session
    // alive. But revoking only BEFORE does not close the real race either: `/login` never consults
    // the revocation marker, it mints a fresh family — so an attacker who still knows the old
    // password only needs a login whose ~120 ms argon2 verify straddles the write, and the new
    // family is stamped after the revocation epoch and survives.
    //
    // Both calls are idempotent, so running them on each side costs one extra write and closes the
    // straddle: a session minted during the window is revoked by the second pass, and a failure in
    // either pass leaves a state where the OLD password is the only thing that still works — which
    // the attacker already had, and which the user can resolve with another link.
    await revokeAllUserSessions(deps.db.refreshTokens, user.id)
    await deps.db.users.setPassword(user.id, newHash)
    await revokeAllUserSessions(deps.db.refreshTokens, user.id)
    await markSessionsRevoked(deps.redis, user.id)
    await deps.db.passwordResetTokens.invalidateAllForUser(user.id, now) // burn any sibling tokens
    deleteCookie(c, COOKIE, { path: COOKIE_PATH })
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true })
  })

  return app
}
