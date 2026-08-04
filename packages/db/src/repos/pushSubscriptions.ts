import type { PrismaClient } from '@prisma/client'

import { isUniqueViolation } from '../errors.js'

/** The endpoint is already registered in ANOTHER tenant — never silently re-homed across tenants. */
export class PushEndpointClaimedError extends Error {
  constructor() {
    super('push endpoint is registered to another tenant')
    this.name = 'PushEndpointClaimedError'
  }
}

import type { Scope } from '../scope.js'

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
}
/** A subscription as the worker's web-push driver needs it. */
export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushSubscriptionRepo {
  /** Store (idempotent by endpoint) a browser's subscription under the caller's scope + user. */
  subscribe(scope: Scope, userId: string, sub: PushSubscriptionInput): Promise<void>
  /** Remove a subscription by endpoint, scoped to the caller's tenant (a browser unsubscribing). */
  unsubscribe(scope: Scope, endpoint: string): Promise<boolean>
  /** UNSCOPED (worker): the account's subscriptions, to fan out a webpush rule channel. */
  listByAccount(tenantId: string, accountId: string): Promise<PushTarget[]>
  /** UNSCOPED (worker): prune a dead subscription (push service returned 404/410 Gone). */
  deleteByEndpoint(endpoint: string): Promise<void>
}

export function createPushSubscriptionRepo(prisma: PrismaClient): PushSubscriptionRepo {
  return {
    subscribe: async (scope, userId, sub) => {
      const accountId = scope.accountId ?? null
      if (accountId === null) throw new Error('push subscribe requires an account scope')
      // Idempotent by the globally-unique endpoint — but re-homing must stay INSIDE the tenant.
      // `upsert({ where: { endpoint } })` had no tenant predicate at all, and its update branch
      // rewrote tenantId/accountId/userId to the caller's: any account_manager in ANY tenant who
      // learned another tenant's endpoint URL (a shared browser, a support-ticket paste of a
      // PushSubscription JSON) could steal the row. The victim silently stopped receiving their own
      // panic/geofence alerts, and the attacker started receiving them. This was the one mutation
      // in the repo layer that could cross the tenant boundary. Audit MED.
      const claimed = await prisma.pushSubscription.updateMany({
        where: { endpoint: sub.endpoint, tenantId: scope.tenantId },
        data: { accountId, userId, p256dh: sub.p256dh, auth: sub.auth },
      })
      if (claimed.count > 0) return
      try {
        await prisma.pushSubscription.create({
          data: { tenantId: scope.tenantId, accountId, userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        })
      } catch (err) {
        // the endpoint exists under ANOTHER tenant: refuse rather than steal it. A browser endpoint
        // is per-installation, so this is either a genuine cross-tenant collision (the user moved
        // employers on the same laptop — they must unsubscribe first) or an attempt.
        if (isUniqueViolation(err)) throw new PushEndpointClaimedError()
        throw err
      }
    },
    unsubscribe: async (scope, endpoint) => {
      // scoped delete: a caller can only drop a subscription in their own tenant, and — when the
      // scope carries an account — only within that account (an undefined accountId ⇒ tenant-wide,
      // e.g. a tenant admin). `accountId: undefined` is a no-op filter in Prisma, so this stays safe.
      const res = await prisma.pushSubscription.deleteMany({ where: { endpoint, tenantId: scope.tenantId, accountId: scope.accountId } })
      return res.count > 0
    },
    listByAccount: async (tenantId, accountId) => {
      const rows = await prisma.pushSubscription.findMany({ where: { tenantId, accountId }, select: { endpoint: true, p256dh: true, auth: true } })
      return rows
    },
    deleteByEndpoint: async (endpoint) => {
      await prisma.pushSubscription.deleteMany({ where: { endpoint } })
    },
  }
}
