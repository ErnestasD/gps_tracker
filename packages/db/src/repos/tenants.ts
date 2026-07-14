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
  /** the subscribed BASE price id (which plan) — for the usage reporter's included-device lookup */
  subscriptionPriceId: string | null
  currentPeriodEnd: Date | null
}

/** An active subscriber for the daily usage reporter (PR B2). */
export interface ActiveSubscriber {
  tenantId: string
  stripeCustomerId: string
  subscriptionPriceId: string | null
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
  /** Webhook path: write subscription state, resolving the tenant by customer id. Applied ONLY when
   *  `eventAt` is strictly newer than the last applied event (monotonic guard vs out-of-order/duplicate
   *  delivery — this WHERE is atomic, so concurrent duplicates collapse). Returns false when nothing
   *  was updated (unknown customer, or a stale/replayed event). */
  applySubscriptionEvent(stripeCustomerId: string, eventAt: Date, data: SubscriptionUpdate): Promise<boolean>
  /** Worker usage reporter (PR B2): tenants with an active/trialing subscription + a customer id. */
  listActiveSubscribers(): Promise<ActiveSubscriber[]>
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
    applySubscriptionEvent: async (stripeCustomerId, eventAt, data) => {
      // Atomic monotonic guard: match the customer AND only when this event is strictly newer than the
      // last applied one. A reordered stale event (older `eventAt`) or a replay (equal `eventAt`) matches
      // zero rows → no-op. Concurrent duplicates collapse: the first write advances lastBillingEventAt,
      // the second's `lt` predicate then fails. An unknown customer id also matches zero rows.
      const result = await prisma.tenant.updateMany({
        where: { stripeCustomerId, OR: [{ lastBillingEventAt: null }, { lastBillingEventAt: { lt: eventAt } }] },
        data: {
          stripeSubscriptionId: data.stripeSubscriptionId,
          subscriptionStatus: data.subscriptionStatus,
          // only overwrite the base price when this event actually carried one (expanded items ∩
          // allowlist) — a malformed/unexpanded event must not null out a good plan → drop from billing
          ...(data.subscriptionPriceId !== null ? { subscriptionPriceId: data.subscriptionPriceId } : {}),
          currentPeriodEnd: data.currentPeriodEnd,
          lastBillingEventAt: eventAt,
        },
      })
      return result.count > 0
    },
    listActiveSubscribers: async () => {
      const rows = await prisma.tenant.findMany({
        where: { stripeCustomerId: { not: null }, subscriptionStatus: { in: ['active', 'trialing'] } },
        select: { id: true, stripeCustomerId: true, subscriptionPriceId: true },
      })
      // stripeCustomerId is non-null by the WHERE; assert for the type
      return rows.map((r) => ({ tenantId: r.id, stripeCustomerId: r.stripeCustomerId!, subscriptionPriceId: r.subscriptionPriceId }))
    },
  }
}
