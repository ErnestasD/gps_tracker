import type { AuthUserRow, Db } from '@orbetra/db'
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

const notImpl = (): never => {
  throw new Error('repo not available in redis-only fake Db')
}

/** Inert Db for redis-only specs (ws/devicesLast use only auth + redis). */
export function fakeDb(users: AuthUserRow[] = []): Db {
  const repo = { list: notImpl, get: notImpl, create: notImpl, update: notImpl, remove: notImpl }
  return {
    auth: {
      users: {
        findByEmailAllTenants: (email: string) => Promise.resolve(users.filter((u) => u.email === email)),
        findByIdForAuth: (id: string) => Promise.resolve(users.find((u) => u.id === id) ?? null),
        setPassword: () => Promise.resolve(),
      },
      refreshTokens: {
        create: () => Promise.resolve(),
        claimForRotation: () => Promise.resolve(null),
        findByTokenHash: () => Promise.resolve(null),
        revokeFamily: () => Promise.resolve(),
      },
    },
    tenants: { list: notImpl, get: notImpl, create: notImpl, update: notImpl, remove: notImpl, updateBranding: notImpl },
    tenantDomains: { list: notImpl, get: notImpl, create: notImpl, remove: notImpl, setVerified: notImpl, isVerifiedDomain: notImpl, tenantIdForDomain: notImpl },
    accounts: repo,
    users: repo,
    devices: { list: notImpl, get: notImpl, getByImei: notImpl, create: notImpl, update: notImpl, retire: notImpl },
    profiles: { list: notImpl, get: notImpl, map: notImpl },
    rules: repo,
    webhooks: repo,
    apiKeys: { list: notImpl, create: notImpl, revoke: notImpl, findActiveByHash: notImpl, touch: notImpl },
    commands: { create: notImpl, get: notImpl, listForDevice: notImpl },
    exports: { create: notImpl, get: notImpl, list: notImpl, findPending: notImpl, pathOf: notImpl },
    webhookDeliveries: { list: notImpl },
    usage: { platformSummary: notImpl, tenantSummary: notImpl },
    events: { list: notImpl, get: notImpl },
    trips: { list: notImpl, get: notImpl },
    geofences: { list: notImpl, get: notImpl, create: notImpl, update: notImpl, remove: notImpl },
    audit: { record: () => Promise.resolve(), list: notImpl, get: notImpl },
    $disconnect: () => Promise.resolve(),
  }
}

/** ApiDeps with sane test defaults on top of the given WsDeps. */
export function testApiDeps(ws: WsDeps, over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    ...ws,
    db: fakeDb(),
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
