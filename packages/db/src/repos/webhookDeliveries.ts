import type { PrismaClient, WebhookDelivery } from '@prisma/client'

import type { Scope } from '../scope.js'

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
        where: { tenantId: scope.tenantId, ...(uuid(opts.webhookId) ? { webhookId: opts.webhookId } : {}) },
        orderBy: { id: 'desc' },
        take,
        ...(numeric(opts.cursor) ? { cursor: { id: BigInt(opts.cursor!) }, skip: 1 } : {}),
      })
      return rows.map(toView)
    },
  }
}
