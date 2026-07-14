import type { MaintenanceItem, PrismaClient } from '@prisma/client'

import { toInt8OrNull } from '../bigid.js'
import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'
import type { AuditRepo } from './audit.js'

export interface MaintenanceCreate {
  accountId: string
  deviceId: bigint
  title: string
  intervalKm?: number | null
  intervalDays?: number | null
  lastServiceOdoKm?: number | null
  lastServiceAt?: Date | null
  active?: boolean
}
export interface MaintenanceUpdate {
  title?: string
  intervalKm?: number | null
  intervalDays?: number | null
  lastServiceOdoKm?: number | null
  lastServiceAt?: Date | null
  active?: boolean
}

/**
 * Maintenance schedule items (V2). Account-scoped, UUID PK (custom repo — deviceId is a BigInt the
 * route must not blindly trust; the caller scope-gates the device on create). Due is NOT stored —
 * it's computed at read time from the device's current odometer + now (see shared maintenanceDue).
 * `markServiced` resets the baseline (odo + timestamp) when the operator records a completed service.
 */
export interface MaintenanceRepo {
  list(scope: Scope, deviceId?: bigint): Promise<MaintenanceItem[]>
  get(scope: Scope, id: string): Promise<MaintenanceItem | null>
  create(scope: Scope, actor: Actor, data: MaintenanceCreate): Promise<MaintenanceItem>
  update(scope: Scope, actor: Actor, id: string, data: MaintenanceUpdate): Promise<MaintenanceItem | null>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
  /** Record a completed service: set lastServiceOdoKm/lastServiceAt (baseline for the next due). */
  markServiced(scope: Scope, actor: Actor, id: string, at: Date, odoKm: number | null): Promise<MaintenanceItem | null>
}

export function createMaintenanceRepo(prisma: PrismaClient, audit: AuditRepo): MaintenanceRepo {
  const scopedById = (scope: Scope, id: string): Promise<MaintenanceItem | null> =>
    prisma.maintenanceItem.findFirst({ where: { ...scopedWhere(scope), id } })
  return {
    list: (scope, deviceId) =>
      prisma.maintenanceItem.findMany({ where: { ...scopedWhere(scope), ...(deviceId !== undefined ? { deviceId } : {}) }, orderBy: { createdAt: 'desc' } }),
    get: (scope, id) => scopedById(scope, id),
    create: async (scope, actor, data) => {
      const row = await prisma.maintenanceItem.create({
        data: {
          tenantId: scope.tenantId,
          accountId: data.accountId,
          deviceId: data.deviceId,
          title: data.title,
          intervalKm: data.intervalKm ?? null,
          intervalDays: data.intervalDays ?? null,
          lastServiceOdoKm: data.lastServiceOdoKm ?? null,
          lastServiceAt: data.lastServiceAt ?? null,
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
      })
      await audit.record(scope, actor, { action: 'create', entity: 'maintenance', entityId: row.id, after: serialize(row) })
      return row
    },
    update: async (scope, actor, id, data) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      const row = await prisma.maintenanceItem.update({ where: { id: before.id }, data })
      await audit.record(scope, actor, { action: 'update', entity: 'maintenance', entityId: id, before: serialize(before), after: serialize(row) })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await scopedById(scope, id)
      if (before === null) return false
      await prisma.maintenanceItem.delete({ where: { id: before.id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'maintenance', entityId: id, before: serialize(before) })
      return true
    },
    markServiced: async (scope, actor, id, at, odoKm) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      const row = await prisma.maintenanceItem.update({ where: { id: before.id }, data: { lastServiceAt: at, lastServiceOdoKm: odoKm } })
      await audit.record(scope, actor, { action: 'update', entity: 'maintenance', entityId: id, before: serialize(before), after: serialize(row) })
      return row
    },
  }
}

/** BigInt deviceId → string so the audit JSON snapshot never throws on serialization. */
function serialize(r: MaintenanceItem): object {
  return { ...r, deviceId: r.deviceId.toString() }
}

/** Parse a route id to a BigInt device id (non-numeric/overflow → null → caller 404/400). */
export const toDeviceId = (id: string): bigint | null => toInt8OrNull(id)
