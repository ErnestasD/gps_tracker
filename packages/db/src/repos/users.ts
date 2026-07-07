import type { PrismaClient, Role } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

/** API-safe user shape — passwordHash NEVER leaves the repo. */
export interface UserView {
  id: string
  tenantId: string
  accountId: string | null
  email: string
  role: Role
  locale: string
  createdAt: Date
}

export interface UserCreate {
  email: string
  passwordHash: string // API hashes; the repo never sees the raw password
  role: Role
  accountId: string | null
  locale?: string
}
export interface UserUpdate {
  role?: Role
  accountId?: string | null
  locale?: string
  passwordHash?: string
}

const VIEW = { id: true, tenantId: true, accountId: true, email: true, role: true, locale: true, createdAt: true } as const

export interface UserRepo {
  list(scope: Scope): Promise<UserView[]>
  get(scope: Scope, id: string): Promise<UserView | null>
  create(scope: Scope, actor: Actor, data: UserCreate): Promise<UserView>
  update(scope: Scope, actor: Actor, id: string, data: UserUpdate): Promise<UserView | null>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
}

export function createUserRepo(prisma: PrismaClient, audit: AuditRepo): UserRepo {
  const scopedById = (scope: Scope, id: string) => ({ ...scopedWhere(scope), id })
  return {
    list: (scope) => prisma.user.findMany({ where: scopedWhere(scope), select: VIEW, orderBy: { email: 'asc' } }),
    get: (scope, id) => prisma.user.findFirst({ where: scopedById(scope, id), select: VIEW }),
    create: async (scope, actor, data) => {
      const row = await prisma.user.create({
        data: {
          tenantId: scope.tenantId,
          email: data.email.trim().toLowerCase(),
          passwordHash: data.passwordHash,
          role: data.role,
          accountId: data.accountId,
          locale: data.locale ?? 'en',
        },
        select: VIEW,
      })
      await audit.record(scope, actor, { action: 'create', entity: 'user', entityId: row.id, after: row })
      return row
    },
    update: async (scope, actor, id, data) => {
      const before = await prisma.user.findFirst({ where: scopedById(scope, id), select: VIEW })
      if (before === null) return null
      const row = await prisma.user.update({ where: { id }, data, select: VIEW })
      await audit.record(scope, actor, { action: 'update', entity: 'user', entityId: id, before, after: row })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await prisma.user.findFirst({ where: scopedById(scope, id), select: VIEW })
      if (before === null) return false
      await prisma.user.delete({ where: { id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'user', entityId: id, before })
      return true
    },
  }
}
