import type { Account, PrismaClient } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import type { Actor, Scope } from '../scope.js'

/**
 * Deleting an account SetNull's its users' accountId (schema relation), which SILENTLY promotes an
 * account-scoped user (viewer/account_manager bound to this account) to TENANT-WIDE scope — a
 * privilege escalation (audit E1). We refuse to delete an account that still has users; the admin
 * must first reassign or remove them (an explicit, intentional scope change), never a silent one.
 */
export class AccountHasUsersError extends Error {
  constructor(public readonly userCount: number) {
    super(`account has ${userCount} user(s); reassign or remove them before deleting`)
    this.name = 'AccountHasUsersError'
  }
}

export interface AccountCreate {
  name: string
  timezone?: string
}
export interface AccountUpdate {
  name?: string
  timezone?: string
}

/**
 * Language + units for everything the SERVER renders for this fleet (alert e-mails, Telegram,
 * scheduled report tables).
 *
 * Its own type and its own repo method, deliberately NOT four more optional fields on
 * `AccountUpdate`: the preferences route is open to account_managers, and if it reused `update` then
 * the only thing standing between an operator and renaming an account or re-cutting every report's
 * day boundary would be the request schema in the API layer. A narrower repo method makes the floor
 * structural — the route CANNOT write `name` or `timezone` because there is no argument for them.
 */
export interface AccountPreferencesUpdate {
  locale?: string
  unitSpeed?: string
  unitDistance?: string
  unitVolume?: string
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
  /** Display preferences only — see AccountPreferencesUpdate for why this is not `update`. */
  updatePreferences(scope: Scope, actor: Actor, id: string, data: AccountPreferencesUpdate): Promise<Account | null>
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
    // Same scoping as `update` — findScoped is what stops an account-scoped caller from reaching a
    // sibling account, and it is the ONLY thing that does, so it stays in front of every write here.
    // Audited under its own entity so a "who switched the fleet to miles" question is answerable
    // without reading four unrelated account renames.
    updatePreferences: async (scope, actor, id, data) => {
      const before = await findScoped(scope, id)
      if (before === null) return null
      const row = await prisma.account.update({ where: { id }, data })
      await audit.record(scope, actor, { action: 'update', entity: 'accountPrefs', entityId: id, before, after: row })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await findScoped(scope, id)
      if (before === null) return false
      // refuse to orphan users into tenant-wide scope (audit E1) — the caller must reassign first
      const userCount = await prisma.user.count({ where: { accountId: id } })
      if (userCount > 0) throw new AccountHasUsersError(userCount)
      await prisma.account.delete({ where: { id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'account', entityId: id, before })
      return true
    },
  }
}
