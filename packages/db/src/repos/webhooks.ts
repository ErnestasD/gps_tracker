import type { PrismaClient, Webhook } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import { createGenericRepo, type Delegate, type GenericRepo } from './generic.js'

export interface WebhookCreate {
  /** null ⇒ tenant-shared (visible to all accounts of the tenant). */
  accountId: string | null
  url: string
  secret: string
  events?: string[]
  enabled?: boolean
}
export interface WebhookUpdate {
  url?: string
  events?: string[]
  enabled?: boolean
}

export type WebhookRepo = GenericRepo<Webhook, WebhookCreate, WebhookUpdate>

/** Webhooks: tenant-scoped with nullable account (null = tenant-shared). */
export function createWebhookRepo(prisma: PrismaClient, audit: AuditRepo): WebhookRepo {
  return createGenericRepo(prisma.webhook as unknown as Delegate<Webhook>, audit, {
    entity: 'webhook',
    scopeOpts: { nullableAccount: true },
    orderBy: { createdAt: 'desc' },
    redactFields: ['secret'], // never log the HMAC signing secret (review LOW)
  })
}
