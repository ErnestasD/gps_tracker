import type { Event, PrismaClient } from '@prisma/client'

import { toInt8OrNull } from '../bigid.js'
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
  /**
   * Delete events older than `cutoff`, batched (retention sweep, audit MED #53). UNSCOPED BY
   * DESIGN — a retention horizon is platform-wide, and the caller is a background job with no
   * request identity behind it (same shape as `webhookDeliveries.pruneOlderThan`).
   *
   * Events carry `lat`/`lon` for every geofence crossing and panic, so they are raw location data
   * of the same sensitivity as the positions they were derived from — and the published privacy
   * policy and the DPA both name "event data" in the 13-month deletion promise. Only `positions`
   * had a policy, so at month 14 the platform reported telemetry as deleted while a three-year-old
   * commute stayed fully reconstructable from `events` alone.
   */
  pruneOlderThan(cutoff: Date, batchSize?: number): Promise<number>
}

/**
 * Parse a keyset cursor. Anything unparseable yields null — a bad page token starts from the top,
 * never a 500 and never a wrong slice.
 *
 * The id goes through `toInt8OrNull`, not a bare `BigInt()`. `BigInt('99999999999999999999')` does
 * NOT throw; it produces a value Postgres rejects at bind time as an unknown Prisma error, which
 * `dbErrorHttp` cannot map — so it reaches the API's catch-all as a 500 from any authenticated
 * caller. `bigid.ts` exists for exactly this and says so; this parser was written without it.
 */
function keyset(cursor: string | undefined): { at: Date; id: bigint } | null {
  if (cursor === undefined) return null
  const bar = cursor.lastIndexOf('|')
  if (bar === -1) return null
  const at = cursor.slice(0, bar)
  const id = toInt8OrNull(cursor.slice(bar + 1))
  if (!isPgSafeDate(at) || id === null) return null
  return { at: new Date(at), id }
}

export function createEventRepo(prisma: PrismaClient): EventRepo {
  return {
    // All external params are sanitized here so malformed query strings can never reach
    // BigInt()/new Date()/Prisma and 500 (defense in depth, mirrors AuditRepo.list — E05-6).
    list: (scope, opts = {}) => {
      const at = { ...(isPgSafeDate(opts.from) ? { gte: new Date(opts.from!) } : {}), ...(isPgSafeDate(opts.to) ? { lt: new Date(opts.to!) } : {}) }
      const take = Math.min(Math.max(Number.isFinite(opts.take) ? Number(opts.take) : 100, 1), 1000)
      const ks = keyset(opts.cursor)
      const legacyId = ks === null ? toInt8OrNull(opts.cursor ?? '') : null
      // Keyset written into WHERE rather than Prisma's `cursor`, which needs a unique index on the
      // sort key and there is none on (at, id).
      //
      // The `at <= X` bound is REDUNDANT and load-bearing. Postgres cannot turn a bare
      // `at < X OR (at = X AND id < Y)` into an index condition, so it walked the account's whole
      // (tenantId, accountId, at) index from the newest row and filtered — measured at 222k events:
      // 154 ms and 151k buffers on page 3000, with `Rows Removed by Filter: 150001`, against 0.06 ms
      // and 59 buffers with the bound present. That is worse than the `id`-ordered code it replaced,
      // and it degrades with page depth, so paging one account's feed was quadratic.
      const page =
        ks !== null
          ? {
              AND: [
                { at: { lte: ks.at } },
                { OR: [{ at: { lt: ks.at } }, { AND: [{ at: ks.at }, { id: { lt: ks.id } }] }] },
              ],
            }
          : legacyId !== null
            ? { id: { lt: legacyId } } // legacy id-only token — see the orderBy note below
            : {}
      return prisma.event.findMany({
        where: {
          ...scopedWhere(scope),
          ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
          ...(toInt8OrNull(opts.deviceId ?? '') !== null ? { deviceId: toInt8OrNull(opts.deviceId!)! } : {}),
          ...(Object.keys(at).length > 0 ? { at } : {}),
          ...page,
        },
        // Ordered by OCCURRENCE, not by insertion (audit MED). `id` is a sequence, so a device that
        // buffered offline and then flushed inserts hours-old alerts with the newest ids — and every
        // "recent events" view, which is a `take`-limited first page, showed those instead of what
        // actually just happened. A panic from five minutes ago fell off the dashboard because a
        // truck came back into coverage. Ties break on `id` so the order is total and the keyset
        // cursor below cannot skip or repeat a row.
        // A legacy id-only token pages by ID, and is ORDERED by id to match: filtering on `id` while
        // ordering by `at` is neither the old behaviour nor the new one, and a client crossing the
        // deploy would see a jumbled page and then duplicates once its next cursor came from that
        // page's tail. It also keeps the (tenantId, accountId, id) index doing a job.
        orderBy: legacyId !== null ? [{ id: 'desc' }] : [{ at: 'desc' }, { id: 'desc' }],
        take,
      })
    },
    get: (scope, id) => {
      // same guard: an out-of-int8 id is a 404, never a 500 (bigid.ts)
      const n = toInt8OrNull(id)
      return n === null ? Promise.resolve(null) : prisma.event.findFirst({ where: { ...scopedWhere(scope), id: n } })
    },
    pruneOlderThan: async (cutoff, batchSize = 5_000) => {
      const size = Math.min(Math.max(Math.trunc(batchSize), 1), 50_000)
      let total = 0
      for (;;) {
        // batched, like the delivery-log prune: the FIRST run after this ships deletes everything
        // past the horizon at once, and an unbounded DELETE would hold one lock over the table the
        // rule engine writes to on the hot path
        const n = await prisma.$executeRaw`DELETE FROM events WHERE id IN (SELECT id FROM events WHERE at < ${cutoff} LIMIT ${size})`
        total += n
        if (n < size) return total
      }
    },
  }
}
