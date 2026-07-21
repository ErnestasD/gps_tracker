import type { Device, OdometerSource, PrismaClient } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import { toInt8OrNull } from '../bigid.js'
import { isUniqueViolation } from '../errors.js'
import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

export interface DeviceCreate {
  accountId: string
  profileId: string
  imei: string
  name: string
  plate?: string | null
  groupName?: string | null
  /** SIM MSISDN (E.164) — the number config SMS are sent to (SMS gateway). */
  simMsisdn?: string | null
  /** SIM ICCID (18–22 digits) — informational. */
  simIccid?: string | null
  odometerSource?: OdometerSource
}
export interface DeviceUpdate {
  name?: string
  plate?: string | null
  groupName?: string | null
  simMsisdn?: string | null
  simIccid?: string | null
  profileId?: string
  odometerSource?: OdometerSource
}

/**
 * IMEI is GLOBALLY unique — a create colliding with ANOTHER tenant's IMEI would
 * otherwise surface a raw Prisma P2002 as a 500 (review HIGH). The repo catches
 * it and throws this domain error so the API translates it to a 409 / per-row
 * import error WITHOUT leaking that the IMEI exists in another tenant (the API
 * never gets to see the other tenant's row).
 */
export class DuplicateImeiError extends Error {
  constructor(readonly imei: string) {
    super(`IMEI already registered: ${imei}`)
    this.name = 'DuplicateImeiError'
  }
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
  /** Count of NON-retired devices in scope — the denominator for the plan deviceLimit cap check. */
  countActive(scope: Scope): Promise<number>
  get(scope: Scope, id: string): Promise<Device | null>
  getByImei(scope: Scope, imei: string): Promise<Device | null>
  create(scope: Scope, actor: Actor, data: DeviceCreate): Promise<Device>
  update(scope: Scope, actor: Actor, id: string, data: DeviceUpdate): Promise<Device | null>
  /** Sets retiredAt=now (soft delete); returns the row or null if out of scope. */
  retire(scope: Scope, actor: Actor, id: string): Promise<Device | null>
}

/** Parse a route id to BigInt; non-numeric/out-of-int8-range → null (caller → 404). */
const toBigId = (id: string): bigint | null => toInt8OrNull(id)

export function createDeviceRepo(prisma: PrismaClient, audit: AuditRepo): DeviceRepo {
  const scopedById = async (scope: Scope, id: string): Promise<Device | null> => {
    const bid = toBigId(id)
    if (bid === null) return null
    return prisma.device.findFirst({ where: { ...scopedWhere(scope), id: bid } })
  }
  return {
    list: (scope) => prisma.device.findMany({ where: scopedWhere(scope), orderBy: { createdAt: 'desc' } }),
    countActive: (scope) => prisma.device.count({ where: { ...scopedWhere(scope), retiredAt: null } }),
    get: (scope, id) => scopedById(scope, id),
    getByImei: (scope, imei) => prisma.device.findFirst({ where: { ...scopedWhere(scope), imei } }),
    create: async (scope, actor, data) => {
      let row
      try {
        row = await prisma.device.create({
          data: {
            tenantId: scope.tenantId,
            accountId: data.accountId,
            profileId: data.profileId,
            imei: data.imei,
            name: data.name,
            plate: data.plate ?? null,
            groupName: data.groupName ?? null,
            simMsisdn: data.simMsisdn ?? null,
            simIccid: data.simIccid ?? null,
            ...(data.odometerSource !== undefined ? { odometerSource: data.odometerSource } : {}),
          },
        })
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateImeiError(data.imei) // global imei clash
        throw err
      }
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
