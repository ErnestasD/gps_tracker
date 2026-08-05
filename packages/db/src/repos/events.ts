import type { Event, PrismaClient } from '@prisma/client'

import { isPgSafeDate } from '../dateGuard.js'
import type { Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

export interface EventListOpts {
  take?: number
  /**
   * Keyset cursor: `"<at ISO>|<id>"` from the last row of the previous page — returns rows strictly
   * older in (at, id) order. A bare numeric id is still accepted, from a client holding a cursor
   * minted before events were ordered by occurrence; it degrades to the old id-only page.
   */
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

const numeric = (s: string | undefined): boolean => s !== undefined && /^\d+$/.test(s)

/** Parse a keyset cursor. Anything unparseable yields null — a bad page token starts from the top,
 *  it never 500s and never silently returns the wrong slice. */
function keyset(cursor: string | undefined): { at: Date; id: bigint } | null {
  if (cursor === undefined) return null
  const bar = cursor.lastIndexOf('|')
  if (bar === -1) return null
  const at = cursor.slice(0, bar)
  const id = cursor.slice(bar + 1)
  if (!isPgSafeDate(at) || !/^\d+$/.test(id)) return null
  return { at: new Date(at), id: BigInt(id) }
}

/** The page token to hand back for a row — mirrors `keyset` above. */
export const eventCursor = (e: Pick<Event, 'at' | 'id'>): string => `${e.at.toISOString()}|${e.id.toString()}`

export function createEventRepo(prisma: PrismaClient): EventRepo {
  return {
    // All external params are sanitized here so malformed query strings can never reach
    // BigInt()/new Date()/Prisma and 500 (defense in depth, mirrors AuditRepo.list — E05-6).
    list: (scope, opts = {}) => {
      const at = { ...(isPgSafeDate(opts.from) ? { gte: new Date(opts.from!) } : {}), ...(isPgSafeDate(opts.to) ? { lt: new Date(opts.to!) } : {}) }
      const take = Math.min(Math.max(Number.isFinite(opts.take) ? Number(opts.take) : 100, 1), 1000)
      const ks = keyset(opts.cursor)
      // Keyset written into WHERE rather than Prisma's `cursor`, which needs a unique index on the
      // sort key and there is none on (at, id). `at < X OR (at = X AND id < Y)` is the standard
      // form and rides the existing (tenantId, accountId, at) index.
      const page =
        ks !== null
          ? { OR: [{ at: { lt: ks.at } }, { AND: [{ at: ks.at }, { id: { lt: ks.id } }] }] }
          : numeric(opts.cursor)
            ? { id: { lt: BigInt(opts.cursor!) } } // legacy id-only token
            : {}
      return prisma.event.findMany({
        where: {
          ...scopedWhere(scope),
          ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
          ...(numeric(opts.deviceId) ? { deviceId: BigInt(opts.deviceId!) } : {}),
          ...(Object.keys(at).length > 0 ? { at } : {}),
          ...page,
        },
        // Ordered by OCCURRENCE, not by insertion (audit MED). `id` is a sequence, so a device that
        // buffered offline and then flushed inserts hours-old alerts with the newest ids — and every
        // "recent events" view, which is a `take`-limited first page, showed those instead of what
        // actually just happened. A panic from five minutes ago fell off the dashboard because a
        // truck came back into coverage. Ties break on `id` so the order is total and the keyset
        // cursor below cannot skip or repeat a row.
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take,
      })
    },
    get: (scope, id) => (numeric(id) ? prisma.event.findFirst({ where: { ...scopedWhere(scope), id: BigInt(id) } }) : Promise.resolve(null)),
  }
}
