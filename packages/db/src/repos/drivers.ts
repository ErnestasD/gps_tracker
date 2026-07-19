import type { Driver, PrismaClient } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import { isUniqueViolation } from '../errors.js'
import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

export interface DriverCreate {
  accountId: string
  name: string
  licenseNo?: string | null
  ibutton?: string | null
  phone?: string | null
  notes?: string | null
  active?: boolean
}
export interface DriverUpdate {
  name?: string
  licenseNo?: string | null
  ibutton?: string | null
  phone?: string | null
  notes?: string | null
  active?: boolean
}

/**
 * iButton is unique WITHIN a tenant. A create/update colliding with another driver's key would
 * otherwise surface a raw Prisma P2002 as a 500. The repo catches it and throws this domain error
 * so the API returns 409 without revealing which driver holds the key (mirrors DuplicateImeiError).
 */
export class DriverIbuttonConflictError extends Error {
  constructor(readonly ibutton: string) {
    super(`iButton already assigned: ${ibutton}`)
    this.name = 'DriverIbuttonConflictError'
  }
}
/**
 * Driver registry (V2). Account-scoped (non-null accountId), UUID PK — like rules, but a custom
 * repo (not generic) so the iButton unique-violation becomes a domain error the API can 409.
 * `findByIbutton` (scoped) is for the follow-up that resolves a tapped iButton to a driver.
 */
export interface DriverRepo {
  list(scope: Scope): Promise<Driver[]>
  get(scope: Scope, id: string): Promise<Driver | null>
  findByIbutton(scope: Scope, ibutton: string): Promise<Driver | null>
  create(scope: Scope, actor: Actor, data: DriverCreate): Promise<Driver>
  update(scope: Scope, actor: Actor, id: string, data: DriverUpdate): Promise<Driver | null>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
  /** UNSCOPED boot rehydrate (no request scope): every ACTIVE driver that has an iButton, across all
   *  tenants, so the API can repopulate the `driver:ibutton:*` Redis map after a Redis flush. */
  listAllIbuttons(): Promise<{ tenantId: string; accountId: string; ibutton: string; driverId: string }[]>
}

/** Canonicalize an iButton to upper-case hex WITH leading zeros stripped, so every hex string that
 * denotes the SAME physical key collides on the tenant-unique index. Tap-resolution reduces the key
 * to its decimal value (`ibuttonKeyFromHex` = BigInt('0x'+hex)), so 'A1B2C3D4' and '00A1B2C3D4'
 * resolve identically — but Postgres text compares case- and length-sensitively, so without this the
 * unique index would let BOTH insert and the Redis resolution map would silently overwrite one with
 * the other (ambiguous/mis-attributed taps). Stripping leading zeros + upper-casing yields the unique
 * canonical hex for a value (BigInt(hex) is invariant to both), so the index now matches resolution.
 * The stored form stays HEX (the API's ibuttonKeyFromHex reads this column as hex), just canonical. */
const canonIbutton = (v: string | null | undefined): string | null | undefined => {
  if (typeof v !== 'string') return v
  const stripped = v.toUpperCase().replace(/^0+/, '')
  return stripped === '' ? '0' : stripped // all-zero key → keep a single '0', never empty
}

export function createDriverRepo(prisma: PrismaClient, audit: AuditRepo): DriverRepo {
  const scopedById = (scope: Scope, id: string): Promise<Driver | null> =>
    prisma.driver.findFirst({ where: { ...scopedWhere(scope), id } })
  return {
    list: (scope) => prisma.driver.findMany({ where: scopedWhere(scope), orderBy: { createdAt: 'desc' } }),
    get: (scope, id) => scopedById(scope, id),
    findByIbutton: (scope, ibutton) => prisma.driver.findFirst({ where: { ...scopedWhere(scope), ibutton: canonIbutton(ibutton) ?? ibutton } }),
    listAllIbuttons: async () => {
      const rows = await prisma.driver.findMany({ where: { active: true, ibutton: { not: null } }, select: { tenantId: true, accountId: true, ibutton: true, id: true } })
      return rows.map((r) => ({ tenantId: r.tenantId, accountId: r.accountId, ibutton: r.ibutton!, driverId: r.id }))
    },
    create: async (scope, actor, data) => {
      let row
      try {
        row = await prisma.driver.create({
          data: {
            tenantId: scope.tenantId,
            accountId: data.accountId,
            name: data.name,
            licenseNo: data.licenseNo ?? null,
            ibutton: canonIbutton(data.ibutton) ?? null,
            phone: data.phone ?? null,
            notes: data.notes ?? null,
            ...(data.active !== undefined ? { active: data.active } : {}),
          },
        })
      } catch (err) {
        if (isUniqueViolation(err) && data.ibutton != null) throw new DriverIbuttonConflictError(data.ibutton)
        throw err
      }
      await audit.record(scope, actor, { action: 'create', entity: 'driver', entityId: row.id, after: row })
      return row
    },
    update: async (scope, actor, id, data) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      // canonicalize the key on update too (same case-collision reason as create)
      const patch = 'ibutton' in data ? { ...data, ibutton: canonIbutton(data.ibutton) ?? null } : data
      let row
      try {
        row = await prisma.driver.update({ where: { id: before.id }, data: patch })
      } catch (err) {
        if (isUniqueViolation(err) && data.ibutton != null) throw new DriverIbuttonConflictError(data.ibutton)
        throw err
      }
      await audit.record(scope, actor, { action: 'update', entity: 'driver', entityId: id, before, after: row })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await scopedById(scope, id)
      if (before === null) return false
      await prisma.driver.delete({ where: { id: before.id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'driver', entityId: id, before })
      return true
    },
  }
}
