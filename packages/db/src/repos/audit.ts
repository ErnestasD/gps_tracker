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
  /**
   * Record a PLATFORM-level action (affiliates, commissions) — `tenantId` is null.
   *
   * These entities have no subject tenant, and filing them under the acting admin's own tenant
   * (a) splits the money trail across whichever tenants the platform admins happen to belong to,
   * and (b) exposes every partner's commercial terms — commissionPct, commissionMonths, and each
   * payout decision — to any tenant-wide `tsp_admin` co-resident in that tenant, since
   * `READ_POLICY.audit = TENANT_ADMINS`. Read back via `listPlatform`, which is platform-only.
   */
  recordPlatform(
    /** `{ userId: null }` is legitimate here and ONLY here: some platform events have no human
     *  behind them (a Stripe webhook reversing a commission). Recording them as nobody is honest;
     *  attributing them to a placeholder user would not be. */
    actor: Actor | { userId: null },
    entry: { action: 'create' | 'update' | 'delete'; entity: string; entityId: string; before?: unknown; after?: unknown },
  ): Promise<void>
  /**
   * Record an update ONLY when the snapshots actually differ. Returns whether a row was written.
   *
   * OPT-IN, and deliberately not the behaviour of `record`. "before equals after" means "nothing
   * happened" only where the snapshot COVERS the mutation. It does not:
   *   - `users.update` hides `passwordHash`, so a password reset used to compare equal;
   *   - `geofences.update` snapshots {name, kind, color}, so a redrawn polygon compares equal;
   *   - `webhooks` stores `secret: '***'` on both sides, so a key rotation compares equal.
   * Making this the default would delete exactly the rows an audit trail exists for. The callers
   * below use it because their snapshot is the whole record the action can touch.
   *
   * What it removes instead: a Save that changed nothing. The Branding page PATCHes the whole
   * object on every click and each asset upload writes a companion branding row, so a tenant's
   * trail filled up with rows whose two sides were byte-identical — 8 of them on the founder's own
   * tenant, reported as "why is this even here".
   */
  recordIfChanged(
    scope: Scope,
    actor: Actor,
    entry: { entity: string; entityId: string; before: unknown; after: unknown },
  ): Promise<boolean>
  list(scope: Scope, opts?: AuditListOpts): Promise<AuditLog[]>
  /** The platform trail (`tenantId IS NULL`) — no tenant can reach it; the route is platform-only. */
  listPlatform(opts?: AuditListOpts): Promise<AuditLog[]>
  get(scope: Scope, id: string): Promise<AuditLog | null>
}

/**
 * Key order is not meaningful in a JSON snapshot, so compare on a sorted rendering.
 *
 * BIGINT IS HANDLED FIRST and by hand: `JSON.stringify(1n)` THROWS, and a device row's `id` is a
 * bigint — so the naive version of this function turned every device PATCH into a 500. The
 * E03-6 coverage test caught it; that is what it is for. Dates fall through to JSON.stringify,
 * which gives the ISO string the column stores anyway.
 */
function stable(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${k}:${stable(o[k])}`).join(',')}}`
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return JSON.stringify(value ?? null) ?? 'null'
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
    recordIfChanged: async (scope, actor, entry) => {
      if (stable(entry.before) === stable(entry.after)) return false
      await prisma.auditLog.create({
        data: {
          tenantId: scope.tenantId,
          userId: actor.userId,
          action: 'update',
          entity: entry.entity,
          entityId: entry.entityId,
          before: (entry.before ?? null) as never,
          after: (entry.after ?? null) as never,
        },
      })
      return true
    },
    recordPlatform: async (actor, entry) => {
      await prisma.auditLog.create({
        data: {
          tenantId: null, // platform-level: no subject tenant, and no tenant may read it
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
    listPlatform: (opts = {}) => {
      const at = { ...(isPgSafeDate(opts.from) ? { gte: new Date(opts.from!) } : {}), ...(isPgSafeDate(opts.to) ? { lt: new Date(opts.to!) } : {}) }
      const take = Math.min(Math.max(Number.isFinite(opts.take) ? Number(opts.take) : 50, 1), 200)
      const cursorOk = opts.cursor !== undefined && /^\d+$/.test(opts.cursor)
      return prisma.auditLog.findMany({
        where: {
          tenantId: null,
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
