import type { PrismaClient, Tenant } from '@prisma/client'

import { effectiveEntitlementsAt, type Entitlements, type TenantPlan } from '@orbetra/shared'

import type { AuditRepo } from './audit.js'
import type { Actor } from '../scope.js'

/** A self-serve signup whose email already belongs to a user (in any tenant) — mapped to 409 by the
 *  route. Blocking it keeps the login lookup unambiguous (an email in two tenants → the 409 ambiguous
 *  identity trap). */
/** A tenant that still carries commission rows cannot be hard-deleted — the ledger is a financial
 *  record (audit HIGH). Mapped to 409 by the route, mirroring AccountHasUsersError. */
export class TenantHasCommissionsError extends Error {
  constructor(readonly commissionCount: number) {
    super(`tenant has ${commissionCount} commission record(s); the payout ledger must not be destroyed`)
    this.name = 'TenantHasCommissionsError'
  }
}

export class SignupEmailInUseError extends Error {
  constructor() {
    super('email already in use')
    this.name = 'SignupEmailInUseError'
  }
}

/** Direct self-serve signup payload (F2). The route resolves `referredByAffiliateId` from a ?ref code
 *  and hashes the password before calling this. Creates tenant + default account + tenant-admin user. */
export interface SelfServeSignup {
  tenantName: string
  accountName: string
  email: string
  passwordHash: string
  plan: TenantPlan
  /** trial end — stored as currentPeriodEnd; getEntitlements floors a `trialing` tenant past it. */
  trialEndsAt: Date
  referredByAffiliateId: string | null
}

export interface TenantCreate {
  name: string
  branding?: unknown
  /** entitlement tier; omitted ⇒ DB default (tsp_grow). platform_admin sets TSP tiers at create. */
  plan?: TenantPlan
  /** referral attribution (item 5): the affiliate this tenant signed up under. Resolved from an
   *  ACTIVE referral code by the caller; commissions accrue from this tenant's payments (F4). */
  referredByAffiliateId?: string | null
}
export interface TenantUpdate {
  name?: string
  branding?: unknown
  /** entitlement tier (platform_admin only; the browser never reaches this repo). */
  plan?: TenantPlan
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
  /** entitlement tier resolved from the subscribed price; written under the SAME monotonic guard as
   *  subscriptionPriceId, and ONLY when the event actually carried one (null ⇒ leave the plan intact). */
  plan?: TenantPlan | null
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
  /** The tenant's entitlement tier — the plan-gating helpers read this to compute entitlements. */
  getPlan(tenantId: string): Promise<TenantPlan>
  /** The tenant's EFFECTIVE entitlements — the plan matrix gated on its live Stripe subscription
   *  status. A lapsed subscription (canceled/unpaid/expired/paused) drops to the zero floor, so a
   *  non-paying tenant can't keep billable features. This is the authoritative gate; prefer it over
   *  `getPlan` + `planEntitlements` (which ignores billing status). */
  getEntitlements(tenantId: string): Promise<Entitlements>
  /** F2 self-serve signup: atomically create a tenant (on `plan`, trialing until `trialEndsAt`) + a
   *  default account + a tenant-admin user. Throws SignupEmailInUseError if the email already exists. */
  createSelfServeSignup(data: SelfServeSignup): Promise<{ tenantId: string; userId: string }>
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
    getPlan: async (tenantId) => {
      const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } })
      if (row === null) throw new Error(`tenant not found: ${tenantId}`)
      return row.plan
    },
    getEntitlements: async (tenantId) => {
      const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true, subscriptionStatus: true, currentPeriodEnd: true, stripeSubscriptionId: true } })
      if (row === null) throw new Error(`tenant not found: ${tenantId}`)
      // trial-aware (F2): a `trialing` tenant past currentPeriodEnd floors immediately. Shared with the
      // session hint the web nav reads, so UI and server can never disagree.
      return effectiveEntitlementsAt(row.plan, row.subscriptionStatus, row.currentPeriodEnd, row.stripeSubscriptionId)
    },
    createSelfServeSignup: async (data) => {
      // An email already present in ANY tenant would make login ambiguous (two matches ⇒ the 409
      // ambiguous-identity trap), so signup refuses it. `email` is unique only PER TENANT by design
      // (the same person may exist across a TSP's sub-tenants), so uniqueness here has to be enforced
      // by us, not by a constraint.
      //
      // The race is real and wide: hashPassword runs before this call and can take hundreds of ms
      // under argon2 contention, so two concurrent signups for one email would both pass a plain
      // check and both insert (READ COMMITTED cannot see the other's uncommitted row) — leaving two
      // tenants that share an email, i.e. a permanently 409-ing login. A transaction-scoped ADVISORY
      // LOCK keyed on the email serializes them: the loser blocks until the winner commits, then sees
      // the row and gets a clean SignupEmailInUseError.
      const existing = await prisma.user.findFirst({ where: { email: data.email }, select: { id: true } })
      if (existing !== null) throw new SignupEmailInUseError()
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.email}))`
        if (await tx.user.findFirst({ where: { email: data.email }, select: { id: true } })) throw new SignupEmailInUseError()
        const tenant = await tx.tenant.create({
          data: {
            name: data.tenantName,
            branding: {},
            plan: data.plan,
            subscriptionStatus: 'trialing',
            currentPeriodEnd: data.trialEndsAt,
            ...(data.referredByAffiliateId != null ? { referredByAffiliateId: data.referredByAffiliateId } : {}),
          },
        })
        await tx.account.create({ data: { tenantId: tenant.id, name: data.accountName, timezone: 'UTC' } })
        // the owner is a TENANT-WIDE admin (accountId null) — a tsp_admin manages the whole tenant
        const user = await tx.user.create({
          data: { tenantId: tenant.id, accountId: null, email: data.email, passwordHash: data.passwordHash, role: 'tsp_admin', locale: 'en' },
        })
        return { tenantId: tenant.id, userId: user.id }
      })
    },
    create: async (actor, data) => {
      const row = await prisma.tenant.create({
        data: {
          name: data.name,
          branding: (data.branding ?? {}) as never,
          ...(data.plan !== undefined ? { plan: data.plan } : {}),
          ...(data.referredByAffiliateId != null ? { referredByAffiliateId: data.referredByAffiliateId } : {}),
        },
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
          ...(data.plan !== undefined ? { plan: data.plan } : {}),
        },
      })
      await audit.record({ tenantId: id }, actor, { action: 'update', entity: 'tenant', entityId: id, before, after: row })
      return row
    },
    remove: async (actor, id) => {
      const before = await prisma.tenant.findUnique({ where: { id } })
      if (before === null) return false
      // the commission ledger outlives the tenant (money owed//paid must stay reconcilable). The FK is
      // RESTRICT, so this check turns an opaque 500 into an explicit, actionable 409.
      const commissionCount = await prisma.commission.count({ where: { tenantId: id } })
      if (commissionCount > 0) throw new TenantHasCommissionsError(commissionCount)
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
      //
      // Per-SUBSCRIPTION guard (audit P4): the customer-level monotonic guard alone lets a late-delivered
      // "OLD subscription deleted" (newer eventAt) overwrite the tenant's CURRENT live one — e.g. cancel
      // A → resubscribe B, then a delayed "A canceled" flips the tenant to canceled despite an active B.
      // The guard applies ONLY to a NON-LIVE incoming event (a cancel/lapse): it may only touch the tenant
      // when it is for the SAME subscription, or the tenant has no live sub to protect. A LIVE incoming
      // event (a new/refreshed subscription) always wins under the monotonic guard, regardless of sub id —
      // this preserves the mirror case where B-created is delivered BEFORE A-canceled (monotonic then
      // drops the stale A-cancel), which a blanket different-sub block would break.
      const incomingLive = data.subscriptionStatus === 'active' || data.subscriptionStatus === 'trialing'
      const result = await prisma.tenant.updateMany({
        where: {
          stripeCustomerId,
          AND: [
            { OR: [{ lastBillingEventAt: null }, { lastBillingEventAt: { lt: eventAt } }] },
            ...(incomingLive
              ? []
              : [
                  {
                    OR: [
                      { stripeSubscriptionId: null },
                      ...(data.stripeSubscriptionId !== null ? [{ stripeSubscriptionId: data.stripeSubscriptionId }] : []),
                      { subscriptionStatus: null },
                      { subscriptionStatus: { notIn: ['active', 'trialing'] } },
                    ],
                  },
                ]),
          ],
        },
        data: {
          stripeSubscriptionId: data.stripeSubscriptionId,
          subscriptionStatus: data.subscriptionStatus,
          // only overwrite the base price when this event actually carried one (expanded items ∩
          // allowlist) — a malformed/unexpanded event must not null out a good plan → drop from billing
          ...(data.subscriptionPriceId !== null ? { subscriptionPriceId: data.subscriptionPriceId } : {}),
          // the entitlement tier rides the SAME guard as the price: written only when the caller
          // resolved a plan for this event; a missing/unmapped plan leaves the existing tier intact
          ...(data.plan != null ? { plan: data.plan } : {}),
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
