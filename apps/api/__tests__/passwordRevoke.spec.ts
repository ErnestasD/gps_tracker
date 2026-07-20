import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AuthUserRow } from '@orbetra/db'

import { createAuthRoutes, type AuthRouteDeps } from '../src/auth/login.js'
import { hashPassword } from '../src/auth/passwords.js'
import { mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * E03 review HIGH: a password change (self-service) must revoke EVERY refresh family of the user,
 * not just the current cookie's, so a stolen/other session cannot outlive the change. apps/api is
 * wired to call refreshTokens.revokeAllForUser when the repo exposes it; this spec proves the
 * wiring (all sessions die) AND documents the fallback (only the current family dies) that applies
 * until packages/db ships that method — see apps/api/src/auth/revoke.ts.
 */
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

const PW = 'correct horse battery staple'
let currentHash = ''

interface Row { familyId: string; userId: string; tokenHash: string; rotatedAt: Date | null; revokedAt: Date | null; expiresAt: Date }

function makeUser(): AuthUserRow {
  return { id: 'u1', tenantId: 't1', accountId: null, email: 'u@orbetra.test', passwordHash: currentHash, role: 'tsp_admin', locale: 'en', plan: 'tsp_grow' }
}

function makeDeps(withRevokeAll: boolean): { deps: AuthRouteDeps; rows: Map<string, Row>; revokeAllSpy: ReturnType<typeof vi.fn>; seed: (raw: string, familyId: string) => void } {
  const user = makeUser()
  const rows = new Map<string, Row>()
  const revokeAllSpy = vi.fn()
  const refreshTokens = {
    create: (r: { id: string; familyId: string; userId: string; tokenHash: string; expiresAt: Date }) => {
      rows.set(r.tokenHash, { familyId: r.familyId, userId: r.userId, tokenHash: r.tokenHash, rotatedAt: null, revokedAt: null, expiresAt: r.expiresAt })
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
    ...(withRevokeAll
      ? {
          revokeAllForUser: (userId: string, now: Date) => {
            revokeAllSpy(userId)
            for (const r of rows.values()) if (r.userId === userId && r.revokedAt === null) r.revokedAt = now
            return Promise.resolve()
          },
        }
      : {}),
  }
  const db = {
    users: {
      findByEmailAllTenants: () => Promise.resolve([user]),
      findByIdForAuth: (id: string) => Promise.resolve(id === user.id ? user : null),
      setPassword: (_id: string, hash: string) => { user.passwordHash = hash; return Promise.resolve() },
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
    rows.set(sha256(raw), { familyId, userId: user.id, tokenHash: sha256(raw), rotatedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 1e9) })
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
    const { deps, revokeAllSpy, seed } = makeDeps(true)
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

  it('fallback (no revokeAllForUser): only the current session dies — documents the pre-db-method gap', async () => {
    const { deps, seed } = makeDeps(false)
    const app = createAuthRoutes(deps, () => '127.0.0.1')
    seed('token-a', 'famA')
    seed('token-b', 'famB')
    const token = await mintTestToken({ userId: 'u1', tenantId: 't1', role: 'tsp_admin' })

    expect((await changePassword(app, token, 'token-a')).status).toBe(200)
    // current family revoked…
    expect((await refresh(app, 'token-a')).status).toBe(401)
    // …but the other session survives until packages/db ships revokeAllForUser (TODO(db))
    expect((await refresh(app, 'token-b')).status).toBe(200)
  })

  it('a wrong current password is rejected and revokes nothing', async () => {
    const { deps, revokeAllSpy, seed } = makeDeps(true)
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
