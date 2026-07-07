import type { Event, PrismaClient } from '@prisma/client'

import type { Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

export interface EventListOpts {
  take?: number
  /** cursor = last seen event id (bigint as string). */
  cursor?: string
  kind?: string
  deviceId?: string
}

/** Events are pipeline-generated (E05-x) — read-only over the API. Account-scoped. */
export interface EventRepo {
  list(scope: Scope, opts?: EventListOpts): Promise<Event[]>
  get(scope: Scope, id: string): Promise<Event | null>
}

export function createEventRepo(prisma: PrismaClient): EventRepo {
  return {
    list: (scope, opts = {}) =>
      prisma.event.findMany({
        where: {
          ...scopedWhere(scope),
          ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
          ...(opts.deviceId !== undefined ? { deviceId: BigInt(opts.deviceId) } : {}),
        },
        orderBy: { id: 'desc' },
        take: Math.min(opts.take ?? 100, 1000),
        ...(opts.cursor !== undefined ? { cursor: { id: BigInt(opts.cursor) }, skip: 1 } : {}),
      }),
    get: (scope, id) => prisma.event.findFirst({ where: { ...scopedWhere(scope), id: BigInt(id) } }),
  }
}
