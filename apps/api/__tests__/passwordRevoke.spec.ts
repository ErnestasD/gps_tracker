import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AuthUserRow } from '@orbetra/db'

import { createAuthRoutes, type AuthRouteDeps } from '../src/auth/login.js'
import { hashPassword } from '../src/auth/passwords.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * E03 review HIGH: a password change (self-service) must revoke EVERY refresh family of the user,
 * not just the current cookie's, so a stolen or attacker-held session cannot outlive the change.
 *
 * This spec used to ALSO document a fallback in which only the current family died — the behaviour
 * while `revokeAllForUser` was optional on the repo interface. It is required now, and the case it
 * documented was the security hole: the one session a password change is meant to kill is the one
 * the owner is not sitting in front of.
 */
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

const PW = 'correct horse battery staple'
let currentHash = ''

interface Row { familyId: string; userId: string; tokenHash: string; rotatedAt: Date | null; revokedAt: Date | null; expiresAt: Date; createdAt: Date }

function makeUser(): AuthUserRow {
  return { id: 'u1', tenantId: 't1', accountId: null, email: 'u@orbetra.test', passwordHash: currentHash, role: 'tsp_admin', locale: 'en', plan: 'tsp_grow', subscriptionStatus: null, currentPeriodEnd: null, stripeSubscriptionId: null, emailVerifiedAt: new Date() }
}

function makeDeps(): { deps: AuthRouteDeps; rows: Map<string, Row>; revokeAllSpy: ReturnType<typeof vi.fn>; seed: (raw: string, familyId: string) => void } {
  const user = makeUser()
  const rows = new Map<string, Row>()
  const epoch: { at: Date | null } = { at: null } // User.sessionsRevokedAt
  const revokeAllSpy = vi.fn()
  const refreshTokens = {
    create: (r: { id: string; familyId: string; userId: string; tokenHash: string; expiresAt: Date }) => {
      rows.set(r.tokenHash, { familyId: r.familyId, userId: r.userId, tokenHash: r.tokenHash, rotatedAt: null, revokedAt: null, expiresAt: r.expiresAt, createdAt: new Date(Date.now() - 1_000) })
      return Promise.resolve()
    },
    claimForRotation: (tokenHash: string, now: Date) => {
      const row = rows.get(tokenHash)
      if (row === undefined || row.rotatedAt !== null || row.revokedAt !== null || row.expiresAt <= now) return Promise.resolve(null)
      row.rotatedAt = now
      return Promise.resolve({ familyId: row.familyId, userId: row.userId })
    },
    findByTokenHash: (tokenHash: string) => {
      const r = rows.get(tokenHash)
      return Promise.resolve(r === undefined ? null : { familyId: r.familyId, userId: r.userId, rotatedAt: r.rotatedAt, revokedAt: r.revokedAt, expiresAt: r.expiresAt })
    },
    revokeFamily: (familyId: string, now: Date) => {
      for (const r of rows.values()) if (r.familyId === familyId && r.revokedAt === null) r.revokedAt = now
      return Promise.resolve()
    },
    familyRevoked: (familyId: string) =>
      Promise.resolve([...rows.values()].some((r) => r.familyId === familyId && r.revokedAt !== null)),
    // mirrors packages/db `rotate`: claim, check the user's session epoch, insert the successor.
    // The double is single-threaded so it cannot model the LOCK — the interleaving proof lives in
    // auth.spec.ts against a real Postgres; this keeps the epoch semantics honest here.
    rotate: (tokenHash: string, now: Date, successor: { id: string; tokenHash: string; expiresAt: Date }) => {
      const row = rows.get(tokenHash)
      if (row === undefined || row.rotatedAt !== null || row.revokedAt !== null || row.expiresAt <= now) return Promise.resolve(null)
      row.rotatedAt = now
      if (epoch.at !== null && row.createdAt <= epoch.at) return Promise.resolve(null)
      rows.set(successor.tokenHash, { familyId: row.familyId, userId: row.userId, tokenHash: successor.tokenHash, rotatedAt: null, revokedAt: null, expiresAt: successor.expiresAt, createdAt: new Date() })
      return Promise.resolve({ familyId: row.familyId, userId: row.userId })
    },
    revokeAllForUser: (userId: string, now: Date) => {
      revokeAllSpy(userId)
      epoch.at = now // the real repo stamps User.sessionsRevokedAt in the SAME transaction
      for (const r of rows.values()) if (r.userId === userId && r.revokedAt === null) r.revokedAt = now
      return Promise.resolve()
    },
  }
  const db = {
    users: {
      findByEmailAllTenants: () => Promise.resolve([user]),
      findByIdForAuth: (id: string) => Promise.resolve(id === user.id ? user : null),
      setPassword: (_id: string, hash: string) => { user.passwordHash = hash; return Promise.resolve() },
      setLocale: () => Promise.resolve(),
    },
    refreshTokens,
  }
  const deps = {
    db: db as unknown as AuthRouteDeps['db'],
    redis: {} as unknown as Redis, // /password + /refresh never touch redis
    jwtSecret: TEST_JWT_SECRET,
    jwtTtlS: 900,
    refreshTtlS: 1_209_600,
    lockout: { maxFails: 5, windowS: 900 },
    secureCookies: false,
    trustProxy: false,
  }
  const seed = (raw: string, familyId: string): void => {
    rows.set(sha256(raw), { familyId, userId: user.id, tokenHash: sha256(raw), rotatedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 1e9), createdAt: new Date(Date.now() - 1_000) })
  }
  return { deps, rows, revokeAllSpy, seed }
}

const changePassword = (app: ReturnType<typeof createAuthRoutes>, token: string, cookieRaw: string): Response | Promise<Response> =>
  app.request('/password', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', cookie: `orb_refresh=${cookieRaw}` },
    body: JSON.stringify({ currentPassword: PW, newPassword: 'a-brand-new-password' }),
  })

const refresh = (app: ReturnType<typeof createAuthRoutes>, raw: string): Response | Promise<Response> =>
  app.request('/refresh', { method: 'POST', headers: { cookie: `orb_refresh=${raw}` } })

beforeAll(async () => {
  currentHash = await hashPassword(PW)
})

describe('password change revokes refresh families (review HIGH)', () => {
  it('with revokeAllForUser: EVERY other session can no longer refresh', async () => {
    const { deps, revokeAllSpy, seed } = makeDeps()
    const app = createAuthRoutes(deps, () => '127.0.0.1')
    seed('token-a', 'famA') // this session (cookie)
    seed('token-b', 'famB') // another logged-in session
    const token = await mintTestToken({ userId: 'u1', tenantId: 't1', role: 'tsp_admin' })

    const res = await changePassword(app, token, 'token-a')
    expect(res.status).toBe(200)
    expect(revokeAllSpy).toHaveBeenCalledWith('u1')

    // the OTHER session's refresh is now rejected (family revoked)
    expect((await refresh(app, 'token-b')).status).toBe(401)
    // and so is the session that changed it
    expect((await refresh(app, 'token-a')).status).toBe(401)
  })

  it('EVERY session dies, not just the one that changed the password', async () => {
    // This replaces a test that documented the opposite — "only the current session dies … until
    // packages/db ships revokeAllForUser". The method has existed for a while; only the optional
    // call site was left behind, so a password change on a compromised account left the ATTACKER's
    // session alive, which is the one case the whole eviction exists for.
    const { deps, seed, revokeAllSpy } = makeDeps()
    const app = createAuthRoutes(deps, () => '127.0.0.1')
    seed('token-a', 'famA') // the session doing the change
    seed('token-b', 'famB') // another device — or the attacker
    const token = await mintTestToken({ userId: 'u1', tenantId: 't1', role: 'tsp_admin' })

    expect((await changePassword(app, token, 'token-a')).status).toBe(200)
    expect(revokeAllSpy).toHaveBeenCalledWith('u1')
    expect((await refresh(app, 'token-a')).status).toBe(401)
    expect((await refresh(app, 'token-b')).status).toBe(401)
  })

  it('a REVOKE failure does not turn a successful password change into a 500', async () => {
    // The write commits first, so a repo rejection (the 40P01 deadlock `rotate`'s own docstring
    // says is possible) told the user their change failed for a password that HAD changed — and
    // because the two revokes were sequential awaits, the fallback family revoke never ran either.
    const { deps, seed } = makeDeps()
    const failing = { ...deps.db.refreshTokens, revokeAllForUser: () => Promise.reject(new Error('deadlock detected')) }
    const app = createAuthRoutes({ ...deps, db: { ...deps.db, refreshTokens: failing } }, () => '127.0.0.1')
    seed('token-a', 'famA')
    const token = await mintTestToken({ userId: 'u1', tenantId: 't1', role: 'tsp_admin' })

    expect((await changePassword(app, token, 'token-a')).status).toBe(200)
    // …and the family the caller DID hold is still revoked — the two are attempted independently
    expect((await refresh(app, 'token-a')).status).toBe(401)
  })

  it('a refresh IN FLIGHT during the revoke does not resurrect the family (revocation fence)', async () => {
    // REGRESSION (audit high): claim → read user → insert are three separate statements, and every
    // eviction path is an `updateMany WHERE revokedAt IS NULL` — which cannot match a row that did
    // not exist when it ran. So a refresh racing a password reset wrote a fresh UNREVOKED row and
    // the family rotated on for the full 14-day TTL; the reset evicted nobody. The eviction is
    // fired here from findByIdForAuth, which is exactly the gap between the claim and the insert.
    const { deps, rows, seed } = makeDeps()
    const app = createAuthRoutes(deps, () => '127.0.0.1')
    seed('token-a', 'famA')

    // the reset lands FIRST; the in-flight refresh must not resurrect the family behind it
    await deps.db.refreshTokens.revokeAllForUser('u1', new Date())

    const res = await refresh(app, 'token-a')
    expect(res.status).toBe(401) // no resurrected token is ever handed out
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/orb_refresh=[0-9a-f]{8}/) // and none leaks in a cookie
    // nothing live remains: the successor was never written, and every seeded row is revoked
    expect([...rows.values()].filter((r) => r.revokedAt === null && r.rotatedAt === null)).toHaveLength(0)
  })

  it('a wrong current password is rejected and revokes nothing', async () => {
    const { deps, revokeAllSpy, seed } = makeDeps()
    const app = createAuthRoutes(deps, () => '127.0.0.1')
    seed('token-a', 'famA')
    const token = await mintTestToken({ userId: 'u1', tenantId: 't1', role: 'tsp_admin' })
    const res = await app.request('/password', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', cookie: 'orb_refresh=token-a' },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'a-brand-new-password' }),
    })
    expect(res.status).toBe(401)
    expect(revokeAllSpy).not.toHaveBeenCalled()
    expect((await refresh(app, 'token-a')).status).toBe(200) // still valid
  })
})
