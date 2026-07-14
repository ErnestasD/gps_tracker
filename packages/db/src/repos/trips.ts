import type { PrismaClient, Trip } from '@prisma/client'

import { toInt8OrNull } from '../bigid.js'
import type { Actor, Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * Trips read repo (E04-3, §6.6) + driver assignment (V2). Trips are WRITTEN by the pipeline
 * (worker raw SQL, E04-1/E04-2); this reads them scoped by tenant/account and exposes the joined
 * driver name. `assignDriver` is the ONLY write here — a light metadata update (driverId), scoped,
 * validating the driver belongs to the same scope. Serialized (BigInt→string, Date→ISO) by json().
 */
export interface TripListOpts {
  deviceId?: string
  from?: string // ISO
  to?: string // ISO
  take?: number
}
/** A trip row plus the joined driver name (null when unassigned). */
export type TripWithDriver = Trip & { driverName: string | null }

export interface TripReadRepo {
  list(scope: Scope, opts?: TripListOpts): Promise<TripWithDriver[]>
  get(scope: Scope, id: string): Promise<TripWithDriver | null>
  /** Assign or clear (driverId=null) the trip's driver. Returns the updated row, or null if the
   *  trip is out of scope; throws DriverNotInScopeError if the driver isn't in the caller's scope. */
  assignDriver(scope: Scope, actor: Actor, tripId: string, driverId: string | null): Promise<TripWithDriver | null>
}

const withDriver = { include: { driver: { select: { name: true } } } } as const
const flat = <T extends Trip & { driver: { name: string } | null }>(r: T): TripWithDriver => {
  const { driver, ...t } = r
  return { ...t, driverName: driver?.name ?? null }
}

const validDate = (s: string | undefined): Date | undefined => {
  if (s === undefined) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Thrown when assignDriver is given a driver outside the caller's scope (→ API 400/404). */
export class DriverNotInScopeError extends Error {
  constructor() {
    super('driver not in scope')
    this.name = 'DriverNotInScopeError'
  }
}

export function createTripRepo(prisma: PrismaClient, audit: AuditRepo): TripReadRepo {
  const scopedById = async (scope: Scope, id: string): Promise<TripWithDriver | null> => {
    const bid = toInt8OrNull(id)
    if (bid === null) return null
    const row = await prisma.trip.findFirst({ where: { ...scopedWhere(scope), id: bid }, ...withDriver })
    return row === null ? null : flat(row)
  }
  return {
    list: async (scope, opts = {}) => {
      const from = validDate(opts.from)
      const to = validDate(opts.to)
      const bid = opts.deviceId !== undefined ? (toInt8OrNull(opts.deviceId) ?? undefined) : undefined
      const rows = await prisma.trip.findMany({
        where: {
          ...scopedWhere(scope),
          ...(bid !== undefined ? { deviceId: bid } : {}),
          ...(from !== undefined || to !== undefined
            ? { startTime: { ...(from !== undefined ? { gte: from } : {}), ...(to !== undefined ? { lte: to } : {}) } }
            : {}),
        },
        orderBy: { startTime: 'desc' },
        take: Math.min(Math.max(Number.isFinite(opts.take) ? Number(opts.take) : 500, 1), 5_000),
        ...withDriver,
      })
      return rows.map(flat)
    },
    get: (scope, id) => scopedById(scope, id),
    assignDriver: async (scope, actor, tripId, driverId) => {
      const before = await scopedById(scope, tripId)
      if (before === null) return null
      // a non-null driver MUST belong to the caller's scope (never assign another tenant's/account's
      // driver) — the scoped lookup is the boundary; null clears the assignment
      if (driverId !== null) {
        const driver = await prisma.driver.findFirst({ where: { ...scopedWhere(scope), id: driverId } })
        if (driver === null) throw new DriverNotInScopeError()
      }
      const row = flat(await prisma.trip.update({ where: { id: before.id }, data: { driverId }, ...withDriver }))
      await audit.record(scope, actor, { action: 'update', entity: 'trip', entityId: tripId, before: { driverId: before.driverId }, after: { driverId: row.driverId } })
      return row
    },
  }
}
