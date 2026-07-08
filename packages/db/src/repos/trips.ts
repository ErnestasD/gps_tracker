import type { PrismaClient, Trip } from '@prisma/client'

import { toInt8OrNull } from '../bigid.js'
import type { Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

/**
 * Trips read repo (E04-3, §6.6). Read-only over the API — trips are WRITTEN by the
 * pipeline (worker raw SQL, E04-1/E04-2), read here scoped by tenant/account. Serialized
 * (BigInt id/deviceId → string, Date → ISO) by the API's json() layer.
 */
export interface TripListOpts {
  deviceId?: string
  from?: string // ISO
  to?: string // ISO
  take?: number
}

export interface TripReadRepo {
  list(scope: Scope, opts?: TripListOpts): Promise<Trip[]>
  get(scope: Scope, id: string): Promise<Trip | null>
}

const validDate = (s: string | undefined): Date | undefined => {
  if (s === undefined) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export function createTripRepo(prisma: PrismaClient): TripReadRepo {
  return {
    list: (scope, opts = {}) => {
      const from = validDate(opts.from)
      const to = validDate(opts.to)
      const bid = opts.deviceId !== undefined ? (toInt8OrNull(opts.deviceId) ?? undefined) : undefined
      return prisma.trip.findMany({
        where: {
          ...scopedWhere(scope),
          ...(bid !== undefined ? { deviceId: bid } : {}),
          ...(from !== undefined || to !== undefined
            ? { startTime: { ...(from !== undefined ? { gte: from } : {}), ...(to !== undefined ? { lte: to } : {}) } }
            : {}),
        },
        orderBy: { startTime: 'desc' },
        take: Math.min(Math.max(Number.isFinite(opts.take) ? Number(opts.take) : 500, 1), 5_000),
      })
    },
    get: (scope, id) => {
      const bid = toInt8OrNull(id)
      return bid === null ? Promise.resolve(null) : prisma.trip.findFirst({ where: { ...scopedWhere(scope), id: bid } })
    },
  }
}
