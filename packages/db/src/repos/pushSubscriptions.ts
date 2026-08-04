import type { PrismaClient } from '@prisma/client'

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
      // ONE statement. Prisma's `upsert` compiled to a native INSERT … ON CONFLICT DO UPDATE, which
      // is race-free — but it had no tenant predicate, so its update branch rewrote
      // tenantId/accountId/userId to the caller's and any tenant that learned an endpoint URL could
      // steal the row (the owner silently stopped receiving their own panic/geofence alerts).
      //
      // Splitting it into claim-then-create fixed the boundary but broke the legitimate path: two
      // same-tenant subscribes race (two tabs, a double-clicked toggle, React StrictMode — every tab
      // gets the SAME endpoint from pushManager.getSubscription()), the loser gets a spurious 409,
      // and apps/web/src/lib/push.ts calls `sub.unsubscribe()` on any throw — destroying the browser
      // subscription the winner just registered. Push then silently dead, DB row revoked. Review high.
      //
      // So: keep it atomic AND scoped, with the predicate Prisma cannot express, in raw SQL.
      // An empty RETURNING means the conflicting row belongs to a DIFFERENT tenant.
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "push_subscriptions" ("tenantId","accountId","userId","endpoint","p256dh","auth")
        VALUES (${scope.tenantId}::uuid, ${accountId}::uuid, ${userId}::uuid,
                ${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
        ON CONFLICT ("endpoint") DO UPDATE
          SET "accountId" = EXCLUDED."accountId",
              "userId"    = EXCLUDED."userId",
              "p256dh"    = EXCLUDED."p256dh",
              "auth"      = EXCLUDED."auth"
          WHERE "push_subscriptions"."tenantId" = ${scope.tenantId}::uuid
        RETURNING "id"`
      if (rows.length === 0) throw new PushEndpointClaimedError()
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
