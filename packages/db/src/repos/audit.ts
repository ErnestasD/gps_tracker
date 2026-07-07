import type { PrismaClient } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'

/**
 * Audit repo (E03-2; E03-6 adds the UI + the repo-manifest meta-test). Every
 * scoped mutation writes one row: who (userId), what (action/entity/entityId),
 * before/after snapshots. Best-effort within the caller — a failed audit write
 * must not silently swallow the mutation, so it throws and the repo wraps it.
 */
export interface AuditRepo {
  record(
    scope: Scope,
    actor: Actor,
    entry: { action: 'create' | 'update' | 'delete'; entity: string; entityId: string; before?: unknown; after?: unknown },
  ): Promise<void>
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
  }
}
