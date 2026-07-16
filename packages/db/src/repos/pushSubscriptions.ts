import type { PrismaClient } from '@prisma/client'

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
      // idempotent by the globally-unique endpoint: re-subscribing re-homes it to the current user/scope
      await prisma.pushSubscription.upsert({
        where: { endpoint: sub.endpoint },
        create: { tenantId: scope.tenantId, accountId, userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        update: { tenantId: scope.tenantId, accountId, userId, p256dh: sub.p256dh, auth: sub.auth },
      })
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
