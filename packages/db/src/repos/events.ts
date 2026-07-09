import type { Event, PrismaClient } from '@prisma/client'

import type { Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

export interface EventListOpts {
  take?: number
  /** cursor = last seen event id (bigint as string); returns rows older than it. */
  cursor?: string
  kind?: string
  deviceId?: string
  /** ISO timestamps bounding `at` (inclusive from, exclusive to). */
  from?: string
  to?: string
}

/** Events are pipeline-generated (E05-x) — read-only over the API. Account-scoped. */
export interface EventRepo {
  list(scope: Scope, opts?: EventListOpts): Promise<Event[]>
  get(scope: Scope, id: string): Promise<Event | null>
}

/** True only for a parseable timestamp — guards `new Date('garbage')` (Invalid Date). */
const validDate = (s: string | undefined): boolean => s !== undefined && !Number.isNaN(new Date(s).getTime())
const numeric = (s: string | undefined): boolean => s !== undefined && /^\d+$/.test(s)

export function createEventRepo(prisma: PrismaClient): EventRepo {
  return {
    // All external params are sanitized here so malformed query strings can never reach
    // BigInt()/new Date()/Prisma and 500 (defense in depth, mirrors AuditRepo.list — E05-6).
    list: (scope, opts = {}) => {
      const at = { ...(validDate(opts.from) ? { gte: new Date(opts.from!) } : {}), ...(validDate(opts.to) ? { lt: new Date(opts.to!) } : {}) }
      const take = Math.min(Math.max(Number.isFinite(opts.take) ? Number(opts.take) : 100, 1), 1000)
      return prisma.event.findMany({
        where: {
          ...scopedWhere(scope),
          ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
          ...(numeric(opts.deviceId) ? { deviceId: BigInt(opts.deviceId!) } : {}),
          ...(Object.keys(at).length > 0 ? { at } : {}),
        },
        orderBy: { id: 'desc' },
        take,
        ...(numeric(opts.cursor) ? { cursor: { id: BigInt(opts.cursor!) }, skip: 1 } : {}),
      })
    },
    get: (scope, id) => (numeric(id) ? prisma.event.findFirst({ where: { ...scopedWhere(scope), id: BigInt(id) } }) : Promise.resolve(null)),
  }
}
