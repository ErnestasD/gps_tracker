import type { AuditLog, PrismaClient } from '@prisma/client'

import { isPgSafeDate } from '../dateGuard.js'
import type { Actor, Scope } from '../scope.js'

/** Read filters for the audit UI (E03-6). All optional; combined with AND. */
export interface AuditListOpts {
  take?: number
  /** cursor = last seen audit id (bigint as string); returns rows older than it. */
  cursor?: string
  entity?: string
  action?: string
  /** ISO timestamps bounding `at` (inclusive from, exclusive to). */
  from?: string
  to?: string
}

/**
 * Audit repo (E03-2; E03-6 adds `list`/`get` + the UI + the coverage meta-test).
 * Every scoped mutation writes one row: who (userId), what (action/entity/entityId),
 * before/after snapshots. Best-effort within the caller — a failed audit write
 * must not silently swallow the mutation, so it throws and the repo wraps it.
 *
 * Read is tenant-scoped ONLY (audit_log has no accountId) and admin-gated at the
 * route (TENANT_ADMINS). Append-only: no update/delete API exists.
 */
export interface AuditRepo {
  record(
    scope: Scope,
    actor: Actor,
    entry: { action: 'create' | 'update' | 'delete'; entity: string; entityId: string; before?: unknown; after?: unknown },
  ): Promise<void>
  list(scope: Scope, opts?: AuditListOpts): Promise<AuditLog[]>
  get(scope: Scope, id: string): Promise<AuditLog | null>
}

export function createAuditRepo(prisma: PrismaClient): AuditRepo {
  return {
    record: async (scope, actor, entry) => {
      await prisma.auditLog.create({
        data: {
          tenantId: scope.tenantId,
          userId: actor.userId,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId,
          before: (entry.before ?? null) as never,
          after: (entry.after ?? null) as never,
        },
      })
    },
    // tenant-scoped by tenantId (NOT scopedWhere — audit_log has no accountId column).
    // All external params are sanitized here so malformed query strings can never
    // reach BigInt()/new Date()/Prisma and 500 (defense in depth for every caller).
    list: (scope, opts = {}) => {
      const at = { ...(isPgSafeDate(opts.from) ? { gte: new Date(opts.from!) } : {}), ...(isPgSafeDate(opts.to) ? { lt: new Date(opts.to!) } : {}) }
      const take = Math.min(Math.max(Number.isFinite(opts.take) ? Number(opts.take) : 50, 1), 200)
      const cursorOk = opts.cursor !== undefined && /^\d+$/.test(opts.cursor)
      return prisma.auditLog.findMany({
        where: {
          tenantId: scope.tenantId,
          ...(opts.entity !== undefined ? { entity: opts.entity } : {}),
          ...(opts.action !== undefined ? { action: opts.action } : {}),
          ...(Object.keys(at).length > 0 ? { at } : {}),
        },
        orderBy: { id: 'desc' },
        take,
        ...(cursorOk ? { cursor: { id: BigInt(opts.cursor!) }, skip: 1 } : {}),
      })
    },
    // non-numeric id can't reach BigInt() (route also guards, but keep the repo safe)
    get: (scope, id) => (/^\d+$/.test(id) ? prisma.auditLog.findFirst({ where: { tenantId: scope.tenantId, id: BigInt(id) } }) : Promise.resolve(null)),
  }
}
