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
        setLocale: () => Promise.resolve(),
        touchLogin: () => Promise.resolve(),
      },
      refreshTokens: {
        create: () => Promise.resolve(),
        claimForRotation: () => Promise.resolve(null),
        findByTokenHash: () => Promise.resolve(null),
        revokeFamily: () => Promise.resolve(),
        revokeAllForUser: () => Promise.resolve(),
        familyRevoked: () => Promise.resolve(false),
        rotate: () => Promise.resolve(null),
      },
      passwordResetTokens: {
        create: () => Promise.resolve(),
        consume: () => Promise.resolve(null),
        invalidateAllForUser: () => Promise.resolve(),
      },
      tokenRetention: { pruneRefreshTokens: notImpl, pruneResetTokens: notImpl, pruneAffiliateTokens: notImpl, pruneVerificationTokens: notImpl },
      emailVerificationTokens: { create: () => Promise.resolve(), consume: () => Promise.resolve(null), findUnverified: () => Promise.resolve(null), invalidateAllForUser: () => Promise.resolve() },
    },
    tenants: { list: notImpl, get: notImpl, getPlan: notImpl, getEntitlements: notImpl, createSelfServeSignup: notImpl, create: notImpl, update: notImpl, remove: notImpl, updateBranding: notImpl, getBilling: notImpl, setStripeCustomer: notImpl, applySubscriptionEvent: notImpl, listActiveSubscribers: notImpl, listLapsedTenants: notImpl, pruneBillingEvents: notImpl, pruneUnverifiedSignups: notImpl, tenantIdForCustomer: notImpl, isSuspended: notImpl, listSuspended: notImpl, registryDevicesFor: notImpl, markLapseNotice: notImpl, suspend: notImpl, unsuspend: notImpl },
    suppressions: { suppress: notImpl, isSuppressed: notImpl, suppressedAmong: notImpl, get: notImpl, release: notImpl, list: notImpl },
    affiliates: { list: notImpl, listWithStats: notImpl, get: notImpl, getActiveByCode: notImpl, create: notImpl, update: notImpl, accrueCommission: notImpl, accrueForPaidInvoice: notImpl, recordClick: notImpl, funnelFor: notImpl, createDeal: notImpl, countPendingDeals: notImpl, domainStanding: notImpl, listDealsForPartner: notImpl, listDeals: notImpl, decideDeal: notImpl, claimFor: notImpl, markDealConverted: notImpl, listCommissions: notImpl, voidCommissionForRefund: notImpl, listCommissionsForPartner: notImpl, listReferredCustomers: notImpl, setCommissionStatus: notImpl, findByEmailForAuth: notImpl, setPassword: notImpl, createPwToken: notImpl, replacePwToken: notImpl, consumePwToken: notImpl, invalidatePwTokens: notImpl },
    tenantDomains: { list: notImpl, get: notImpl, create: notImpl, remove: notImpl, setVerified: notImpl, isVerifiedDomain: notImpl, tenantIdForDomain: notImpl },
    accounts: { ...repo, updatePreferences: notImpl },
    users: repo,
    devices: { list: notImpl, countActive: notImpl, listAllForRegistry: notImpl, imeisIn: notImpl, get: notImpl, getByImei: notImpl, create: notImpl, update: notImpl, retire: notImpl },
    drivers: { list: notImpl, get: notImpl, findByIbutton: notImpl, create: notImpl, update: notImpl, remove: notImpl, listAllIbuttons: notImpl },
    maintenance: { list: notImpl, get: notImpl, create: notImpl, update: notImpl, remove: notImpl, markServiced: notImpl },
    profiles: { list: notImpl, all: notImpl, get: notImpl, map: notImpl },
    rules: { ...repo, listAll: notImpl },
    shareLinks: { list: notImpl, create: notImpl, revoke: notImpl, revokeForDevice: notImpl, resolveByHash: notImpl },
    webhooks: repo,
    scheduledReports: { ...repo, listEnabled: notImpl, claimRun: notImpl },
    pushSubscriptions: { subscribe: notImpl, unsubscribe: notImpl, listByAccount: notImpl, deleteByEndpoint: notImpl },
    apiKeys: { list: notImpl, create: notImpl, revoke: notImpl, findActiveByHash: notImpl, touch: notImpl },
    commands: { create: notImpl, get: notImpl, listForDevice: notImpl },
    smsDeliveries: { create: notImpl, get: notImpl, listForDevice: notImpl, markSent: notImpl, markFailed: notImpl },
    exports: { create: notImpl, get: notImpl, list: notImpl, findPending: notImpl, pathOf: notImpl },
    leads: { create: notImpl, list: notImpl },
    platform: { overview: notImpl, users: notImpl, setUserDisabled: notImpl, touchLogin: notImpl, billing: notImpl, lapses: notImpl, failures: notImpl },
    webhookDeliveries: { list: notImpl, pruneOlderThan: notImpl },
    rawRejects: { insertMany: notImpl, pruneOlderThan: notImpl },
    usage: { platformSummary: notImpl, tenantSummary: notImpl, reportedOverage: notImpl, recordOverageReport: notImpl },
    events: { list: notImpl, get: notImpl, pruneOlderThan: notImpl },
    trips: { list: notImpl, get: notImpl, assignDriver: notImpl, stripCoordinatesOlderThan: notImpl },
    geofences: { list: notImpl, listAll: notImpl, get: notImpl, create: notImpl, update: notImpl, remove: notImpl },
    audit: { record: () => Promise.resolve(), recordPlatform: () => Promise.resolve(), list: notImpl, listPlatform: notImpl, get: notImpl },
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
