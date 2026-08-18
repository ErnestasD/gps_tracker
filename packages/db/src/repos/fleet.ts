import type { MaintenancePlan, PrismaClient, ServiceLogEntry, VehicleDocument, VehicleDocumentKind } from '@prisma/client'
import type { Prisma } from '@prisma/client'

import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * FLEET-1 repos (docs/epics/FLEET-1.md): service log (F2), vehicle documents (F3) and
 * maintenance plan templates (F2). All account-scoped like the maintenance repo; deviceId is a
 * BigInt the ROUTE scope-gates before calling create (same contract as maintenance.ts).
 */

export interface ServiceLogCreate {
  accountId: string
  deviceId: bigint
  maintenanceItemId?: string | null
  title: string
  at: Date
  odoKm?: number | null
  engineH?: number | null
  costCents?: number | null
  currency?: string
  vendor?: string | null
  notes?: string | null
}

export interface ServiceLogRepo {
  /** Newest first; per device, or fleet-wide when deviceId is omitted (capped). */
  list(scope: Scope, deviceId?: bigint, limit?: number): Promise<ServiceLogEntry[]>
  create(scope: Scope, actor: Actor, data: ServiceLogCreate): Promise<ServiceLogEntry>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
}

export interface VehicleDocumentCreate {
  accountId: string
  deviceId: bigint
  kind: VehicleDocumentKind
  title: string
  number?: string | null
  validFrom?: Date | null
  validTo: Date
  note?: string | null
}
export interface VehicleDocumentUpdate {
  kind?: VehicleDocumentKind
  title?: string
  number?: string | null
  validFrom?: Date | null
  validTo?: Date
  note?: string | null
}

export interface VehicleDocumentRepo {
  /** Soonest-expiring first; per device, or fleet-wide when deviceId is omitted. */
  list(scope: Scope, deviceId?: bigint): Promise<VehicleDocument[]>
  get(scope: Scope, id: string): Promise<VehicleDocument | null>
  create(scope: Scope, actor: Actor, data: VehicleDocumentCreate): Promise<VehicleDocument>
  update(scope: Scope, actor: Actor, id: string, data: VehicleDocumentUpdate): Promise<VehicleDocument | null>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
}

export interface MaintenancePlanCreate {
  accountId?: string | null
  name: string
  items: Prisma.InputJsonValue
}
export interface MaintenancePlanUpdate {
  name?: string
  items?: Prisma.InputJsonValue
}

export interface MaintenancePlanRepo {
  list(scope: Scope): Promise<MaintenancePlan[]>
  get(scope: Scope, id: string): Promise<MaintenancePlan | null>
  create(scope: Scope, actor: Actor, data: MaintenancePlanCreate): Promise<MaintenancePlan>
  update(scope: Scope, actor: Actor, id: string, data: MaintenancePlanUpdate): Promise<MaintenancePlan | null>
  remove(scope: Scope, actor: Actor, id: string): Promise<boolean>
}

/** BigInt deviceId → string so the audit JSON snapshot never throws (maintenance.ts precedent). */
const serialize = (r: { deviceId: bigint }): object => ({ ...r, deviceId: r.deviceId.toString() })

export function createServiceLogRepo(prisma: PrismaClient, audit: AuditRepo): ServiceLogRepo {
  return {
    list: (scope, deviceId, limit = 500) =>
      prisma.serviceLogEntry.findMany({
        where: { ...scopedWhere(scope), ...(deviceId !== undefined ? { deviceId } : {}) },
        orderBy: { at: 'desc' },
        take: limit,
      }),
    create: async (scope, actor, data) => {
      const row = await prisma.serviceLogEntry.create({
        data: {
          tenantId: scope.tenantId,
          accountId: data.accountId,
          deviceId: data.deviceId,
          maintenanceItemId: data.maintenanceItemId ?? null,
          title: data.title,
          at: data.at,
          odoKm: data.odoKm ?? null,
          engineH: data.engineH ?? null,
          costCents: data.costCents ?? null,
          ...(data.currency !== undefined ? { currency: data.currency } : {}),
          vendor: data.vendor ?? null,
          notes: data.notes ?? null,
        },
      })
      await audit.record(scope, actor, { action: 'create', entity: 'serviceLog', entityId: row.id, after: serialize(row) })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await prisma.serviceLogEntry.findFirst({ where: { ...scopedWhere(scope), id } })
      if (before === null) return false
      await prisma.serviceLogEntry.delete({ where: { id: before.id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'serviceLog', entityId: id, before: serialize(before) })
      return true
    },
  }
}

export function createVehicleDocumentRepo(prisma: PrismaClient, audit: AuditRepo): VehicleDocumentRepo {
  const scopedById = (scope: Scope, id: string): Promise<VehicleDocument | null> =>
    prisma.vehicleDocument.findFirst({ where: { ...scopedWhere(scope), id } })
  return {
    list: (scope, deviceId) =>
      prisma.vehicleDocument.findMany({
        where: { ...scopedWhere(scope), ...(deviceId !== undefined ? { deviceId } : {}) },
        orderBy: { validTo: 'asc' },
      }),
    get: (scope, id) => scopedById(scope, id),
    create: async (scope, actor, data) => {
      const row = await prisma.vehicleDocument.create({
        data: {
          tenantId: scope.tenantId,
          accountId: data.accountId,
          deviceId: data.deviceId,
          kind: data.kind,
          title: data.title,
          number: data.number ?? null,
          validFrom: data.validFrom ?? null,
          validTo: data.validTo,
          note: data.note ?? null,
        },
      })
      await audit.record(scope, actor, { action: 'create', entity: 'document', entityId: row.id, after: serialize(row) })
      return row
    },
    update: async (scope, actor, id, data) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      const row = await prisma.vehicleDocument.update({ where: { id: before.id }, data })
      await audit.record(scope, actor, { action: 'update', entity: 'document', entityId: id, before: serialize(before), after: serialize(row) })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await scopedById(scope, id)
      if (before === null) return false
      await prisma.vehicleDocument.delete({ where: { id: before.id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'document', entityId: id, before: serialize(before) })
      return true
    },
  }
}

export function createMaintenancePlanRepo(prisma: PrismaClient, audit: AuditRepo): MaintenancePlanRepo {
  // plans are TENANT-wide by design (accountId records who created one, it does not scope reads):
  // a TSP defines "Standartinis vilkikas" once and applies it across accounts — but an
  // account-pinned caller still only sees their tenant's plans via tenantId.
  const scopedById = (scope: Scope, id: string): Promise<MaintenancePlan | null> =>
    prisma.maintenancePlan.findFirst({ where: { tenantId: scope.tenantId, id } })
  return {
    list: (scope) => prisma.maintenancePlan.findMany({ where: { tenantId: scope.tenantId }, orderBy: { createdAt: 'desc' } }),
    get: (scope, id) => scopedById(scope, id),
    create: async (scope, actor, data) => {
      const row = await prisma.maintenancePlan.create({
        data: { tenantId: scope.tenantId, accountId: data.accountId ?? null, name: data.name, items: data.items },
      })
      await audit.record(scope, actor, { action: 'create', entity: 'maintenancePlan', entityId: row.id, after: row })
      return row
    },
    update: async (scope, actor, id, data) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      const row = await prisma.maintenancePlan.update({ where: { id: before.id }, data })
      await audit.record(scope, actor, { action: 'update', entity: 'maintenancePlan', entityId: id, before, after: row })
      return row
    },
    remove: async (scope, actor, id) => {
      const before = await scopedById(scope, id)
      if (before === null) return false
      await prisma.maintenancePlan.delete({ where: { id: before.id } })
      await audit.record(scope, actor, { action: 'delete', entity: 'maintenancePlan', entityId: id, before })
      return true
    },
  }
}
