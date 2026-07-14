import type { PrismaClient, Tenant } from '@prisma/client'

import type { AuditRepo } from './audit.js'
import type { Actor } from '../scope.js'

export interface TenantCreate {
  name: string
  branding?: unknown
}
export interface TenantUpdate {
  name?: string
  branding?: unknown
}

/** Stripe billing state (ADR-024). currentPeriodEnd is an ISO string for the API view. */
export interface BillingState {
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
}
/** Subscription fields written by the signature-verified webhook (never by the browser). */
export interface SubscriptionUpdate {
  stripeSubscriptionId: string | null
  subscriptionStatus: string | null
  currentPeriodEnd: Date | null
}

/**
 * Tenants repo — PLATFORM level (NOT scoped): only platform_admin reaches it (API
 * `requireRole('platform_admin')`). There is no tenant scope above a tenant, so
 * these methods take an Actor for audit but no Scope. Audit rows are stamped with
 * the TARGET tenant id.
 */
export interface TenantRepo {
  list(): Promise<Tenant[]>
  get(id: string): Promise<Tenant | null>
  create(actor: Actor, data: TenantCreate): Promise<Tenant>
  update(actor: Actor, id: string, data: TenantUpdate): Promise<Tenant | null>
  remove(actor: Actor, id: string): Promise<boolean>
  /** Tenant-self branding update (E03-5): the caller passes their OWN tenantId
   * (from auth), and ONLY the branding jsonb is writable — not name (tenant admins
   * brand themselves; renaming a tenant stays platform-only). */
  updateBranding(actor: Actor, tenantId: string, branding: unknown): Promise<Tenant>
  /** Tenant-self billing read (ADR-024): caller passes their OWN tenantId (from auth). */
  getBilling(tenantId: string): Promise<BillingState | null>
  /** Persist the Stripe customer id created lazily on first checkout (tenant-self). */
  setStripeCustomer(tenantId: string, stripeCustomerId: string): Promise<void>
  /** Webhook path: resolve a tenant by its Stripe customer id (no request scope exists). */
  findByStripeCustomer(stripeCustomerId: string): Promise<Tenant | null>
  /** Webhook path: write subscription state, resolving the tenant by customer id.
   *  Returns false if the customer id maps to no tenant (unknown/foreign event). */
  applySubscriptionEvent(stripeCustomerId: string, data: SubscriptionUpdate): Promise<boolean>
}

export function createTenantRepo(prisma: PrismaClient, audit: AuditRepo): TenantRepo {
  return {
    list: () => prisma.tenant.findMany({ orderBy: { name: 'asc' } }),
    get: (id) => prisma.tenant.findUnique({ where: { id } }),
    create: async (actor, data) => {
      const row = await prisma.tenant.create({
        data: { name: data.name, branding: (data.branding ?? {}) as never },
      })
      await audit.record({ tenantId: row.id }, actor, { action: 'create', entity: 'tenant', entityId: row.id, after: row })
      return row
    },
    update: async (actor, id, data) => {
      const before = await prisma.tenant.findUnique({ where: { id } })
      if (before === null) return null
      const row = await prisma.tenant.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.branding !== undefined ? { branding: data.branding as never } : {}),
        },
      })
      await audit.record({ tenantId: id }, actor, { action: 'update', entity: 'tenant', entityId: id, before, after: row })
      return row
    },
    remove: async (actor, id) => {
      const before = await prisma.tenant.findUnique({ where: { id } })
      if (before === null) return false
      await prisma.tenant.delete({ where: { id } })
      await audit.record({ tenantId: id }, actor, { action: 'delete', entity: 'tenant', entityId: id, before })
      return true
    },
    updateBranding: async (actor, tenantId, branding) => {
      const before = await prisma.tenant.findUnique({ where: { id: tenantId } })
      const row = await prisma.tenant.update({ where: { id: tenantId }, data: { branding: branding as never } })
      await audit.record({ tenantId }, actor, { action: 'update', entity: 'branding', entityId: tenantId, before, after: row })
      return row
    },
    getBilling: async (tenantId) => {
      const row = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { stripeCustomerId: true, stripeSubscriptionId: true, subscriptionStatus: true, currentPeriodEnd: true },
      })
      if (row === null) return null
      return {
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        subscriptionStatus: row.subscriptionStatus,
        currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      }
    },
    setStripeCustomer: async (tenantId, stripeCustomerId) => {
      await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId } })
    },
    findByStripeCustomer: (stripeCustomerId) => prisma.tenant.findUnique({ where: { stripeCustomerId } }),
    applySubscriptionEvent: async (stripeCustomerId, data) => {
      // resolve by customer id; a webhook for an unknown customer is a no-op (returns false)
      const result = await prisma.tenant.updateMany({
        where: { stripeCustomerId },
        data: {
          stripeSubscriptionId: data.stripeSubscriptionId,
          subscriptionStatus: data.subscriptionStatus,
          currentPeriodEnd: data.currentPeriodEnd,
        },
      })
      return result.count > 0
    },
  }
}
