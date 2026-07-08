import type { Device, OdometerSource, PrismaClient } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

export interface DeviceCreate {
  accountId: string
  profileId: string
  imei: string
  name: string
  plate?: string | null
  groupName?: string | null
  odometerSource?: OdometerSource
}
export interface DeviceUpdate {
  name?: string
  plate?: string | null
  groupName?: string | null
  profileId?: string
  odometerSource?: OdometerSource
}

/**
 * Devices repo (E03-3). Account-scoped (non-null accountId), like rules. NOT the
 * generic repo: `Device.id` is a BigInt PK, so the route `:id` string must be
 * coerced (a bad/overflowing id resolves to null → 404, never a 500). `imei` is
 * globally unique — `getByImei` is scoped so a caller can't probe another tenant's
 * IMEI. Redis registry sync (registry:imei / device:tenant / device:account) is
 * NOT here — it lives in the API layer (deviceRegistry.ts); this repo is pure DB.
 */
export interface DeviceRepo {
  list(scope: Scope): Promise<Device[]>
  get(scope: Scope, id: string): Promise<Device | null>
  getByImei(scope: Scope, imei: string): Promise<Device | null>
  create(scope: Scope, actor: Actor, data: DeviceCreate): Promise<Device>
  update(scope: Scope, actor: Actor, id: string, data: DeviceUpdate): Promise<Device | null>
  /** Sets retiredAt=now (soft delete); returns the row or null if out of scope. */
  retire(scope: Scope, actor: Actor, id: string): Promise<Device | null>
}

/** Parse a route id to BigInt; non-numeric/overflow → null (caller → 404). */
function toBigId(id: string): bigint | null {
  if (!/^\d+$/.test(id)) return null
  try {
    return BigInt(id)
  } catch {
    return null
  }
}

export function createDeviceRepo(prisma: PrismaClient, audit: AuditRepo): DeviceRepo {
  const scopedById = async (scope: Scope, id: string): Promise<Device | null> => {
    const bid = toBigId(id)
    if (bid === null) return null
    return prisma.device.findFirst({ where: { ...scopedWhere(scope), id: bid } })
  }
  return {
    list: (scope) => prisma.device.findMany({ where: scopedWhere(scope), orderBy: { createdAt: 'desc' } }),
    get: (scope, id) => scopedById(scope, id),
    getByImei: (scope, imei) => prisma.device.findFirst({ where: { ...scopedWhere(scope), imei } }),
    create: async (scope, actor, data) => {
      const row = await prisma.device.create({
        data: {
          tenantId: scope.tenantId,
          accountId: data.accountId,
          profileId: data.profileId,
          imei: data.imei,
          name: data.name,
          plate: data.plate ?? null,
          groupName: data.groupName ?? null,
          ...(data.odometerSource !== undefined ? { odometerSource: data.odometerSource } : {}),
        },
      })
      await audit.record(scope, actor, { action: 'create', entity: 'device', entityId: String(row.id), after: row })
      return row
    },
    update: async (scope, actor, id, data) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      const row = await prisma.device.update({ where: { id: before.id }, data })
      await audit.record(scope, actor, { action: 'update', entity: 'device', entityId: String(row.id), before, after: row })
      return row
    },
    retire: async (scope, actor, id) => {
      const before = await scopedById(scope, id)
      if (before === null) return null
      if (before.retiredAt !== null) return before // already retired — idempotent
      const row = await prisma.device.update({ where: { id: before.id }, data: { retiredAt: new Date() } })
      await audit.record(scope, actor, { action: 'update', entity: 'device', entityId: String(row.id), before, after: row })
      return row
    },
  }
}
