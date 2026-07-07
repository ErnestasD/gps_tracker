/**
 * Tenant/account scope (E03-2, CLAUDE.md rule 2 / PROJECT_PLAN §6.2): the FIRST
 * argument of every scoped repo method. A tenant-wide user (accountId undefined)
 * sees all accounts of their tenant; an account-scoped user sees only their own
 * account. tenantId is ALWAYS constrained — the cross-tenant boundary is the
 * invariant the isolation suite defends forever.
 */
export interface Scope {
  tenantId: string
  /** undefined ⇒ tenant-wide (tsp_admin / platform_admin); set ⇒ single account. */
  accountId?: string
}

/** Who is acting — audit rows record it (E03-6 extends the audit surface). */
export interface Actor {
  userId: string
}

export interface ScopedWhereOpts {
  /**
   * Model's accountId is nullable and null ⇒ tenant-shared (geofences, api_keys,
   * webhooks). An account-scoped user then sees their account's rows PLUS the
   * tenant-shared (null) ones. Non-null-account models ignore this.
   */
  nullableAccount?: boolean
}

/**
 * Prisma `where` fragment enforcing the scope. Spread into a repo query's where.
 * NEVER build a scoped query without this helper — a hand-written where is the
 * §10 #7 "tenant leakage in a quick query" failure the isolation suite exists to
 * catch, but this centralizes it so the mistake is hard to make.
 */
export function scopedWhere(scope: Scope, opts: ScopedWhereOpts = {}): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId: scope.tenantId }
  if (scope.accountId !== undefined) {
    where['accountId'] = opts.nullableAccount
      ? { in: [scope.accountId, null] }
      : scope.accountId
  }
  return where
}

/** Thrown when a create's payload references another tenant/account (defense in depth). */
export class NotInScopeError extends Error {
  constructor(message = 'resource not in scope') {
    super(message)
    this.name = 'NotInScopeError'
  }
}
