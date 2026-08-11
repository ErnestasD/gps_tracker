import type { PrismaClient, WebhookDelivery } from '@prisma/client'

import type { Scope } from '../scope.js'
import { scopedWhere } from '../scope.js'

/**
 * Webhook delivery log — read-only over the API (E06-4b; rows are written by the worker via
 * raw SQL). Tenant-scoped (webhooks are tenant-scoped). All external params are sanitized so
 * malformed query strings can never reach BigInt()/Prisma and 500 (mirrors AuditRepo/EventRepo).
 */
export interface WebhookDeliveryView {
  id: string
  webhookId: string
  eventId: string
  kind: string
  statusCode: number | null
  success: boolean
  error: string | null
  at: string // ISO
}
export interface WebhookDeliveryListOpts {
  take?: number
  cursor?: string // last seen id (bigint as string)
  webhookId?: string
}
export interface WebhookDeliveryRepo {
  list(scope: Scope, opts?: WebhookDeliveryListOpts): Promise<WebhookDeliveryView[]>
  /** UNSCOPED platform-wide retention prune (worker cron): delete rows older than `cutoff`, in
   *  batches so a large first pass never takes one long lock. Returns total rows deleted. */
  pruneOlderThan(cutoff: Date, batchSize?: number): Promise<number>
}

const uuid = (s: string | undefined): boolean => s !== undefined && /^[0-9a-f-]{36}$/i.test(s)
const numeric = (s: string | undefined): boolean => s !== undefined && /^\d+$/.test(s)

function toView(r: WebhookDelivery): WebhookDeliveryView {
  return {
    id: r.id.toString(),
    webhookId: r.webhookId,
    eventId: r.eventId,
    kind: r.kind,
    statusCode: r.statusCode,
    success: r.success,
    error: r.error,
    at: r.at.toISOString(),
  }
}

export function createWebhookDeliveryRepo(prisma: PrismaClient): WebhookDeliveryRepo {
  return {
    list: async (scope, opts = {}) => {
      const take = Math.min(Math.max(Number.isFinite(opts.take) ? Number(opts.take) : 100, 1), 500)
      const rows = await prisma.webhookDelivery.findMany({
        // ACCOUNT-scope, not just tenant: webhook_deliveries carries an accountId (stamped by the
        // worker), and webhooks are account-scoped-with-tenant-shared. Without this an account_manager
        // could read a sibling account's delivery logs in the same tenant (review MED cross-account
        // leak).
        //
        // STRICT account scope, unlike geofences/webhooks/api-keys. For those three a null accountId
        // is a real state with a meaning — "tenant-shared, applies to every account" — so an account
        // user must see them. A DELIVERY has no such meaning: even a tenant-shared webhook stamps
        // each delivery with the account of the device whose event fired it (webhookWorker), and the
        // worker DROPS the log line rather than write an unattributed one. So a null here is an
        // anomaly, and `nullableAccount` would have broadcast every future anomaly — a second
        // writer, a replay, a backfill — to every account in the tenant. The column is nullable at
        // the DB level, so this is the only thing deciding which way such a row fails; it now fails
        // closed (invisible) instead of open (visible to all).
        where: { ...scopedWhere(scope), ...(uuid(opts.webhookId) ? { webhookId: opts.webhookId } : {}) },
        orderBy: { id: 'desc' },
        take,
        ...(numeric(opts.cursor) ? { cursor: { id: BigInt(opts.cursor!) }, skip: 1 } : {}),
      })
      return rows.map(toView)
    },
    pruneOlderThan: async (cutoff, batchSize = 5_000) => {
      const size = Math.min(Math.max(Math.trunc(batchSize), 1), 50_000)
      let total = 0
      for (;;) {
        // batched keyset-free delete: bound each statement so the first (possibly large) prune
        // never holds one long lock on the hot delivery-log table
        const n = await prisma.$executeRaw`DELETE FROM webhook_deliveries WHERE id IN (SELECT id FROM webhook_deliveries WHERE at < ${cutoff} LIMIT ${size})`
        total += n
        if (n < size) break
      }
      return total
    },
  }
}
