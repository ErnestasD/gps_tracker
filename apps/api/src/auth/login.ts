import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Redis } from 'ioredis'

import type { AuthDb, AuthUserRow } from '@orbetra/db'
import { loginRequestSchema, passwordChangeSchema, type AuthSession, type AuthUser } from '@orbetra/shared'

import { mintAccessToken } from './jwt.js'
import { authMiddleware, problem, type AuthEnv } from './middleware.js'
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from './passwords.js'
import { clientIp } from '../net.js'

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
}

const COOKIE = 'orb_refresh'
const COOKIE_PATH = '/v1/auth' // the cookie never rides on data requests

const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')


const toAuthUser = (u: AuthUserRow): AuthUser => ({
  id: u.id,
  email: u.email,
  role: u.role,
  tenantId: u.tenantId,
  accountId: u.accountId,
  locale: u.locale,
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
      const n = await deps.redis.incr(lockKey)
      if (n === 1) await deps.redis.expire(lockKey, deps.lockout.windowS)
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
    // clear the cookie UNCONDITIONALLY first (review LOW: a revoke throw must not
    // leave a live cookie while the SPA believes it logged out)
    deleteCookie(c, COOKIE, { path: COOKIE_PATH })
    const raw = getCookie(c, COOKIE)
    if (raw !== undefined && raw !== '') {
      try {
        const row = await deps.db.refreshTokens.findByTokenHash(sha256(raw))
        if (row) await deps.db.refreshTokens.revokeFamily(row.familyId, new Date())
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

  // self-service password change (E03-2, Settings/Profile). Verify current, set
  // new, revoke ALL of the user's refresh families so other sessions re-login.
  app.post('/password', authMiddleware({ jwtSecret: deps.jwtSecret }), async (c) => {
    const parsed = passwordChangeSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return problem(c, 400, 'Bad Request')
    const auth = c.get('auth')
    const user = await deps.db.users.findByIdForAuth(auth.userId)
    if (user === null) return problem(c, 401, 'Unauthorized')
    if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
      return problem(c, 401, 'Unauthorized', 'current password is wrong')
    }
    await deps.db.users.setPassword(user.id, await hashPassword(parsed.data.newPassword))
    // invalidate the current refresh family (this session's cookie); other sessions
    // continue until their access token expires, then fail to refresh (family gone)
    const raw = getCookie(c, COOKIE)
    if (raw !== undefined && raw !== '') {
      const row = await deps.db.refreshTokens.findByTokenHash(sha256(raw))
      if (row) await deps.db.refreshTokens.revokeFamily(row.familyId, new Date())
    }
    deleteCookie(c, COOKIE, { path: COOKIE_PATH })
    return c.json({ ok: true })
  })

  return app
}
