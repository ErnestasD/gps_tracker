import type { Account, PrismaClient } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import type { Actor, Scope } from '../scope.js'

export interface AccountCreate {
  name: string
  timezone?: string
}
export interface AccountUpdate {
  name?: string
  timezone?: string
}

/**
 * Accounts scope SPECIALLY: the account IS the scope unit (no accountId column).
 * A tenant-wide user sees all accounts of the tenant; an account-scoped user sees
 * only their own (id === scope.accountId). Cross-tenant is always excluded.
 */
export interface AccountRepo {
  list(scope: Scope): Promise<Account[]>
  get(scope: Scope, id: string): Promise<Account | null>
  create(scope: Scope, actor: Actor, data: AccountCreate): Promise<Account>
  update(scope: Scope, actor: Actor, id: string, data: AccountUpdate): Promise<Account | null>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
}

export function createAccountRepo(prisma: PrismaClient, audit: AuditRepo): AccountRepo {
  // list scope: tenant-wide sees all; account-scoped sees only its own account
  const listWhere = (scope: Scope) => ({
    tenantId: scope.tenantId,
    ...(scope.accountId !== undefined ? { id: scope.accountId } : {}),
  })
  // item scope: an account-scoped user reaches ONLY its own account id. Building
  // {tenantId, id: scope.accountId, id} would let the requested id OVERWRITE the
  // scope constraint (isolation-suite-caught bug) — so reject the mismatch first.
  const findScoped = (scope: Scope, id: string) => {
    if (scope.accountId !== undefined && id !== scope.accountId) return Promise.resolve(null)
    return prisma.account.findFirst({ where: { tenantId: scope.tenantId, id } })
  }
  return {
    list: (scope) => prisma.account.findMany({ where: listWhere(scope), orderBy: { name: 'asc' } }),
    get: (scope, id) => findScoped(scope, id),
    create: async (scope, actor, data) => {
      const row = await prisma.account.create({
        data: { tenantId: scope.tenantId, name: data.name, timezone: data.timezone ?? 'UTC' },
      })
      await audit.record(scope, actor, { action: 'create', entity: 'account', entityId: row.id, after: row })
      return row
    },
    update: async (scope, actor, id, data) => {
      const before = await findScoped(scope, id)
      if (before === null) return null
      const row = await prisma.account.update({ where: { id }, data })
      await audit.record(scope, actor, { action: 'update', entity: 'account', entityId: id, before, after: row })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await findScoped(scope, id)
      if (before === null) return false
      await prisma.account.delete({ where: { id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'account', entityId: id, before })
      return true
    },
  }
}
