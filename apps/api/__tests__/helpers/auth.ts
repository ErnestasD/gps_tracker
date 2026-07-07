import type { AuthDb, AuthUserRow } from '@orbetra/db'
import type { Role } from '@orbetra/shared'

import type { ApiDeps } from '../../src/app.js'
import { mintAccessToken } from '../../src/auth/jwt.js'
import type { WsDeps } from '../../src/ws.js'

export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret!' // ≥32 chars

/** Mint a real access token for tests that don't exercise login itself. */
export function mintTestToken(claims: {
  userId: string
  tenantId: string
  accountId?: string
  role?: Role
}): Promise<string> {
  return mintAccessToken(
    {
      sub: claims.userId,
      ten: claims.tenantId,
      ...(claims.accountId !== undefined ? { acc: claims.accountId } : {}),
      role: claims.role ?? 'tsp_admin',
    },
    TEST_JWT_SECRET,
    900,
  )
}

/** Inert AuthDb for redis-only specs (ws/devicesLast never touch Postgres). */
export function fakeAuthDb(users: AuthUserRow[] = []): AuthDb {
  return {
    users: {
      findByEmailAllTenants: (email) => Promise.resolve(users.filter((u) => u.email === email)),
      findByIdForAuth: (id) => Promise.resolve(users.find((u) => u.id === id) ?? null),
    },
    refreshTokens: {
      create: () => Promise.resolve(),
      claimForRotation: () => Promise.resolve(null),
      findByTokenHash: () => Promise.resolve(null),
      revokeFamily: () => Promise.resolve(),
    },
    $disconnect: () => Promise.resolve(),
  }
}

/** ApiDeps with sane test defaults on top of the given WsDeps. */
export function testApiDeps(ws: WsDeps, over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    ...ws,
    db: fakeAuthDb(),
    jwtSecret: TEST_JWT_SECRET,
    jwtTtlS: 900,
    refreshTtlS: 1_209_600,
    lockout: { maxFails: 5, windowS: 900 },
    secureCookies: false,
    trustProxy: false,
    getRemoteAddr: () => '127.0.0.1',
    ...over,
  }
}
