import type { PrismaClient, Tenant } from '@prisma/client'

import { effectiveEntitlementsAt, isBillableSubscription, LAPSED_SUBSCRIPTION_STATUSES, type Entitlements, type TenantPlan } from '@orbetra/shared'

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

/** Internal signal: the customer id in a signature-verified event maps to no tenant. Thrown rather
 *  than returned so the enclosing transaction rolls back the dedupe claim with it; never escapes
 *  the repo (the caller sees `no_tenant`). */
class UnmappedCustomerError extends Error {
  constructor() {
    super('no tenant for stripe customer')
    this.name = 'UnmappedCustomerError'
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
  /** Reporting time zone for the default account (IANA). Omitted ⇒ UTC, which is only right for a
   *  caller whose day genuinely starts at 00:00 UTC — see the route. */
  timezone?: string
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

/**
 * One signature-verified Stripe subscription event, as the ordering guard needs to see it.
 *
 * `at` is `event.created`, which is Unix SECONDS — the reason `type` has to be here at all. Several
 * events for one state change share a second, and Stripe does not promise delivery order, so the
 * type is the only deterministic way to order them: created < updated < deleted.
 */
export interface SubscriptionEvent {
  stripeCustomerId: string
  /** `evt_…` — the durable dedupe key. A Stripe retry carries the SAME id. */
  id: string
  /** e.g. `customer.subscription.deleted` */
  type: string
  at: Date
}

/** Deterministic order for events sharing one `event.created` second. An unknown type ranks WITH
 *  `.updated`: it is a state change of unknown finality, and ranking it above would let it overwrite
 *  a cancel, while ranking it below would let a cancel arriving after it be dropped. */
export function subscriptionEventRank(type: string): number {
  if (type.endsWith('.created')) return 0
  if (type.endsWith('.deleted')) return 2
  return 1
}

/** An active subscriber for the daily usage reporter (PR B2). */
export interface ActiveSubscriber {
  tenantId: string
  stripeCustomerId: string
  subscriptionPriceId: string | null
  /** the entitlement tier, so the reporter can tell "Direct plan, no overage by design" from
   *  "TSP plan whose base price is missing from STRIPE_INCLUDED" — the second is a misconfiguration
   *  that silently zeroed a paying customer's overage bill (audit MED #23). */
  plan: TenantPlan
  /**
   * `null` while the subscription is still billable. Otherwise the instant it lapsed: days AT OR
   * BEFORE it are still owed, days after it are not.
   *
   * Without this the reporter enumerated only CURRENTLY billable tenants, so a tenant that canceled
   * on the 1st took every un-reported day of the trailing window with it — precisely when the
   * incentive to bill is highest, and precisely the days a missed run was supposed to recover.
   */
  billableUntil: Date | null
}

/**
 * A tenant whose entitlements are floored but which is still being served (audit MED #22).
 *
 * The floor is enforced at READ time and only by `deviceLimit`, which is consulted solely when a
 * device is CREATED. So an expired trial or a canceled subscription changes exactly one thing the
 * customer can perceive — "you cannot add another device" — while the trackers keep connecting,
 * positions keep being written and charged to our storage, and live/history/trips/reports keep
 * working indefinitely for free. Nothing anywhere counted these tenants, so the leak was not merely
 * unenforced, it was invisible.
 */
export interface LapsedTenant {
  tenantId: string
  name: string
  plan: TenantPlan
  /** `canceled` / `unpaid` / … , or null for a local trial that simply ran out */
  subscriptionStatus: string | null
  /** when the floor took effect: the trial's period end, or — for a Stripe lapse — the last APPLIED
   *  billing event. The second is an approximation: any later `customer.subscription.*` touch on the
   *  canceled subscription moves it forward, which resets the grace clock. It is the only date the
   *  tenant row carries, and the count itself does not depend on it. */
  lapsedAt: Date | null
  /** why it is floored — a Stripe lapse or an expired self-serve trial */
  reason: 'subscription_lapsed' | 'trial_expired'
  /** devices still registered and still being ingested for free */
  activeDevices: number
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
   *  this event has never been applied before (durably, by `event.id`) AND it is newer than the last
   *  applied one — or lands in the same `event.created` second with a type that ranks at or above the
   *  one already applied. Returns why nothing was written — see SubscriptionApplyResult. */
  applySubscriptionEvent(event: SubscriptionEvent, data: SubscriptionUpdate): Promise<SubscriptionApplyResult>
  /**
   * Worker usage reporter (PR B2): every tenant currently receiving PAID service — i.e. entitled, by
   * the SAME predicate entitlements use (isBillableSubscription), plus a Stripe customer id.
   * Includes `past_due`: dunning is a grace window for access, so it must be one for billing too.
   *
   * `lapsedSince` ADDITIONALLY returns tenants that lapsed at or after that instant — they still owe
   * the days they were live for. Every row carries `billableUntil`, and a caller that passes
   * `lapsedSince` MUST honour it: the extra rows are NOT entitled, and treating them as such would
   * hand a canceled customer paid service. Called without the argument, the result is exactly the
   * billable set and every `billableUntil` is null.
   */
  listActiveSubscribers(lapsedSince?: Date): Promise<ActiveSubscriber[]>
  /** Drop applied-Stripe-event rows older than `cutoff` (retention sweep). Stripe retries for ~3
   *  days, so anything past a wide margin can go; the table would otherwise grow forever. Batched
   *  like its retention siblings so the first pass cannot hold a long lock. Returns rows deleted. */
  pruneBillingEvents(cutoff: Date, batchSize?: number): Promise<number>
  /** The inverse set: tenants whose entitlements are FLOORED right now — a lapsed subscription or an
   *  expired local trial — together with what they are still consuming. Platform-level, for the
   *  billing sweep; see {@link LapsedTenant}. */
  listLapsedTenants(now?: Date): Promise<LapsedTenant[]>
}

/**
 * Why a subscription webhook did or did not change anything.
 * - `applied`  — the tenant row was updated.
 * - `stale`    — the tenant EXISTS but a guard dropped the event (older/replayed/same-second, or a
 *                late non-live event against a live subscription). Normal operation, not an error.
 * - `no_tenant`— no row carries that `stripeCustomerId`: someone is paying and has no plan.
 */
export type SubscriptionApplyResult = 'applied' | 'stale' | 'no_tenant'

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
        // the ACCOUNT time zone drives report day-bucketing (hard rule 7). Hard-coding UTC here
        // meant every self-serve tenant's "yesterday" ran on the wrong day boundary, invisibly.
        await tx.account.create({ data: { tenantId: tenant.id, name: data.accountName, timezone: data.timezone ?? 'UTC' } })
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
    applySubscriptionEvent: async (event, data) => {
      const { stripeCustomerId, id: eventId, type: eventType, at: eventAt } = event
      const rank = subscriptionEventRank(eventType)
      // ONE transaction: the dedupe claim and the write it guards must commit or roll back together.
      // A `no_tenant` outcome rolls the claim back too — signalled by a throw, the only way out of a
      // Prisma interactive transaction — so an admin reconciling `stripeCustomerId` by hand (the
      // documented remedy for that alert) does not find every redelivery silently swallowed.
      try {
        return await prisma.$transaction(async (tx) => {
      // DURABLE redelivery suppression. Stripe retries whenever our 200 is lost or times out, and it
      // retries the ORIGINAL event — so after `updated → deleted`, a retry of `updated` looked like a
      // brand-new same-second event under a single-slot `lastBillingEventId` and flipped the canceled
      // subscription back to active, entitled and uncapped, where it stayed until some unrelated
      // later event moved it. Verified against a real database before this table existed.
      const claimed = await tx.billingEvent.createMany({ data: { eventId, type: eventType, eventAt }, skipDuplicates: true })
      if (claimed.count === 0) return 'stale'
      // Atomic monotonic guard: match the customer AND only when this event is newer than the last
      // applied one. A reordered stale event (older `eventAt`) matches zero rows → no-op. An unknown
      // customer id also matches zero rows.
      //
      // SAME-SECOND ORDERING (audit MED #25). `event.created` is Unix SECONDS, and Stripe emits
      // several events for one state change in the same second — a cancel is `customer.subscription
      // .updated` (status → canceled, cancel_at_period_end) immediately followed by `.deleted`, and a
      // plan change is `.updated` twice. A strict `lt` treated the second one as a replay and dropped
      // it, so the tenant kept the intermediate state: on a same-second cancel the row stayed
      // `active`, entitled and unbilled until some later event happened to touch it.
      //
      // Admitting the equal-second case takes two things the timestamp cannot give. Durable
      // REDELIVERY suppression is the first, and it is the `billing_events` claim above. An order
      // within the second that does not depend on ARRIVAL is the second, and it is `rank` — because
      // Stripe does not guarantee delivery order, and ordering by arrival means a `.deleted`
      // followed by a reordered `.updated` silently undoes a cancel, handing a canceled customer
      // full paid service. That direction was safe before this change only because the strict `lt`
      // dropped every same-second follow-up, including the ones that mattered.
      //
      // KNOWN LIMIT: two events of the SAME rank in one second (a plan change emits `.updated`
      // twice) are still applied in arrival order, because nothing in the payloads orders them. The
      // exposure is a tenant left on the pre-change price for the period; the next event on that
      // subscription — a renewal at the latest — corrects it.
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
      const result = await tx.tenant.updateMany({
        where: {
          stripeCustomerId,
          AND: [
            {
              OR: [
                { lastBillingEventAt: null },
                { lastBillingEventAt: { lt: eventAt } },
                // Same second: admit an event whose TYPE ranks at or above the one already applied,
                // so a reordered `.updated` can never walk back a `.deleted`. `lte`, not `lt`: two
                // same-second `.updated`s — what a plan change emits — must both land. (Equal ranks
                // are therefore applied in ARRIVAL order; nothing in the events distinguishes them.)
                //
                // A NULL rank is NOT admitted: rows written before this column existed carry
                // `lastBillingEventAt` with no rank, and admitting those would reopen the resurrected
                // -cancel bug for Stripe's whole retry horizon after deploy. The migration backfills
                // them to 2 (the maximum), which is the conservative behaviour they were written
                // under; this predicate is the belt to that migration's braces.
                //
                // The exception is a LIVE event for a DIFFERENT subscription. `.deleted`(A) followed
                // in the same second by `.created`(B) is a cancel-and-resubscribe delivered in the
                // CORRECT order, and rank alone dropped it — leaving the paying customer on the
                // canceled subscription, floored to zero entitlements and metered as lapsed. A lower
                // rank for another subscription id is not a reorder of this one's lifecycle. The
                // subscription must differ: a live `.updated`(A) after `.deleted`(A) IS the reorder.
                {
                  AND: [
                    { lastBillingEventAt: eventAt },
                    {
                      OR: [
                        { lastBillingEventRank: { lte: rank } },
                        ...(incomingLive && data.stripeSubscriptionId !== null ? [{ stripeSubscriptionId: { not: data.stripeSubscriptionId } }] : []),
                      ],
                    },
                  ],
                },
              ],
            },
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
          lastBillingEventId: eventId,
          lastBillingEventRank: rank,
        },
      })
      if (result.count > 0) return 'applied'
      // `false` used to mean three different things and the caller could see only one of them. A
      // no-op is NORMAL for a stale/replayed/same-second delivery, or a late non-live event — the
      // guards above exist to drop exactly those. `no_tenant` is the only outcome that means a
      // paying customer is unprovisioned, and the only one worth logging, counting and paging on.
      // Reporting all three as `no_tenant` made the new alert fire on routine Stripe traffic (67%
      // false positives on this repo's own webhook corpus), which is worse than no alert at all.
      const known = await tx.tenant.count({ where: { stripeCustomerId } })
      if (known === 0) throw new UnmappedCustomerError() // rolls back the claim — see above
      return 'stale'
        })
      } catch (err) {
        if (err instanceof UnmappedCustomerError) return 'no_tenant'
        throw err
      }
    },
    listActiveSubscribers: async (lapsedSince) => {
      // METERED == ENTITLED, by construction (audit high). Not a hand-kept `in [...]` list: the
      // previous one omitted `past_due`, which entitlements deliberately treat as a grace window —
      // so a card failure bought full service with zero billing for the entire dunning period.
      const rows = (
        await prisma.tenant.findMany({
          where: { stripeCustomerId: { not: null }, subscriptionStatus: { not: null } },
          select: { id: true, stripeCustomerId: true, subscriptionPriceId: true, subscriptionStatus: true, plan: true, lastBillingEventAt: true },
        })
      ).filter((r) => {
        if (isBillableSubscription(r.subscriptionStatus)) return true
        // RECENTLY lapsed tenants are still owed for the days they WERE billable. Enumerating only
        // the currently-billable ones meant a cancel on the 1st erased every un-reported day of the
        // reporter's trailing window — the days a missed run exists to recover, for the customer
        // with the least reason to come back and pay them.
        return lapsedSince !== undefined && r.lastBillingEventAt !== null && r.lastBillingEventAt >= lapsedSince
      })
      // stripeCustomerId is non-null by the WHERE; assert for the type
      return rows.map((r) => ({
        tenantId: r.id,
        stripeCustomerId: r.stripeCustomerId!,
        subscriptionPriceId: r.subscriptionPriceId,
        plan: r.plan,
        billableUntil: isBillableSubscription(r.subscriptionStatus) ? null : r.lastBillingEventAt,
      }))
    },
    pruneBillingEvents: async (cutoff, batchSize = 5_000) => {
      const size = Math.min(Math.max(Math.trunc(batchSize), 1), 50_000)
      let total = 0
      for (;;) {
        const deleted = await prisma.$executeRaw`
          DELETE FROM "billing_events"
           WHERE "eventId" IN (SELECT "eventId" FROM "billing_events" WHERE "appliedAt" < ${cutoff} ORDER BY "appliedAt" LIMIT ${size})`
        total += deleted
        if (deleted < size) return total
      }
    },
    listLapsedTenants: async (now = new Date()) => {
      // Derived from the SAME predicate the entitlement gate uses (effectiveEntitlementsAt), not a
      // second hand-kept list — the last time those two drifted, `past_due` was entitled but not
      // metered and a dunning tenant got the full product free for the whole grace window.
      const rows = await prisma.tenant.findMany({
        where: {
          OR: [
            { subscriptionStatus: { in: [...LAPSED_SUBSCRIPTION_STATUSES] } },
            // a LOCAL trial that ran out: `trialing` with no Stripe subscription behind it. The
            // stripeSubscriptionId discriminator matters — a Stripe-side trial also reports
            // `trialing`, and flooring one of those would cut off a paying customer.
            { AND: [{ subscriptionStatus: 'trialing' }, { stripeSubscriptionId: null }, { currentPeriodEnd: { lt: now } }] },
          ],
        },
        select: { id: true, name: true, plan: true, subscriptionStatus: true, currentPeriodEnd: true, lastBillingEventAt: true, stripeSubscriptionId: true },
      })
      if (rows.length === 0) return []
      const counts = await prisma.device.groupBy({ by: ['tenantId'], where: { tenantId: { in: rows.map((r) => r.id) }, retiredAt: null }, _count: { _all: true } })
      const byTenant = new Map(counts.map((c) => [c.tenantId, c._count._all]))
      return rows.map((r) => {
        const trialExpired = r.subscriptionStatus === 'trialing' && r.stripeSubscriptionId === null
        return {
          tenantId: r.id,
          name: r.name,
          plan: r.plan,
          subscriptionStatus: r.subscriptionStatus,
          lapsedAt: trialExpired ? r.currentPeriodEnd : r.lastBillingEventAt,
          reason: trialExpired ? ('trial_expired' as const) : ('subscription_lapsed' as const),
          activeDevices: byTenant.get(r.id) ?? 0,
        }
      })
    },
  }
}
