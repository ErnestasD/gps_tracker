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
  /** the signer-up's UI language (en|lt|de|pl), so the verification mail and every later
   *  transactional mail arrive in the language they just used. Omitted ⇒ en. */
  locale?: string
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
  /** when the fleet was cut off for non-payment; null = serving. The UI needs this to explain an
   *  empty live map — "no devices are reporting" and "we stopped accepting their data" look
   *  identical on screen and could not be more different to the person looking at it. */
  suspendedAt: string | null
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
  /** already suspended? Suspended tenants stay in this list so the sweep can UN-suspend one whose
   *  payment landed while the webhook path was down. */
  suspendedAt: Date | null
  /** which lapse notice has already been sent IN THIS EPISODE: 0 none, 1 grace-end, 2 +1 day, 3 +2
   *  days (final). A stage recorded against a DIFFERENT `lapsedAt` reads as 0 — see `lapseNoticeFor`. */
  noticeStage: number
  /** the tenant admin to write to, and in which language. Null when the tenant somehow has no user. */
  contactEmail: string | null
  contactLocale: string
}

/** A device as the registry needs it, for suspending or restoring one tenant's fleet. */
export interface TenantRegistryDevice {
  id: bigint
  imei: string
  tenantId: string
  accountId: string
  presenceRules: unknown
  odometerSource: string
  /** The profile's AVL dictionary. Carried here for the same reason presenceRules is: a restore
   *  rebuilds `device:config` wholesale, so anything missing from this row is DROPPED from the
   *  fleet's config until the next restart or device edit — here that would put every device in a
   *  restored tenant back on the FMB120 fallback and silently mislabel its IO attributes. */
  avlTable: string
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
  /**
   * Delete tenants created by a self-serve signup that was NEVER activated (audit MED #67).
   *
   * Verification made signup safe to answer identically for a taken and a free address, but the free
   * branch still WRITES: probing an address leaves a real tenant squatting it, and an ordinary
   * abandoned signup leaves the same debris. A tenant qualifies only when it can have no owner and
   * no history — every user unverified, no devices, no commissions — so this can never reach an
   * account someone actually uses.
   *
   * Platform-level, called by the daily sweep. Returns tenants deleted.
   */
  pruneUnverifiedSignups(cutoff: Date, limit?: number): Promise<number>
  /** Drop applied-Stripe-event rows older than `cutoff` (retention sweep). Stripe retries for ~3
   *  days, so anything past a wide margin can go; the table would otherwise grow forever. Batched
   *  like its retention siblings so the first pass cannot hold a long lock. Returns rows deleted. */
  pruneBillingEvents(cutoff: Date, batchSize?: number): Promise<number>
  /** The inverse set: tenants whose entitlements are FLOORED right now — a lapsed subscription or an
   *  expired local trial — together with what they are still consuming. Platform-level, for the
   *  billing sweep; see {@link LapsedTenant}. */
  listLapsedTenants(now?: Date): Promise<LapsedTenant[]>
  /** The tenant behind a Stripe customer id — the restore-on-payment path, which has the customer
   *  id from the webhook and nothing else. */
  tenantIdForCustomer(stripeCustomerId: string): Promise<string | null>
  /** Is this tenant suspended right now? The restore paths check BEFORE touching Redis, so the flag
   *  is cleared only after the registry is actually back. */
  isSuspended(tenantId: string): Promise<boolean>
  /** Tenants currently SUSPENDED. The restore pass reads this rather than filtering the lapsed
   *  list, because a tenant that has paid is by definition absent from that list. */
  listSuspended(): Promise<{ tenantId: string; suspendedAt: Date }[]>
  /** Every ACTIVE device of one tenant, in the registry's shape — the suspend/restore payload. */
  registryDevicesFor(tenantId: string): Promise<TenantRegistryDevice[]>
  /** Record that a lapse notice went out, against the lapse it belongs to, so the daily sweep never
   *  repeats or skips one — and so a LATER, unrelated lapse starts the ladder from the beginning. */
  markLapseNotice(tenantId: string, stage: number, forLapse: Date | null): Promise<void>
  /** Mark a tenant suspended (the registry teardown is the caller's — this is the durable record).
   *  Conditional: returns false when it was ALREADY suspended, so a re-run neither re-mails nor
   *  re-logs, and the count an operator sees is the number of tenants actually cut off. */
  suspend(tenantId: string, at: Date): Promise<boolean>
  /**
   * Clear suspension. Returns false when it was not suspended, so the caller can skip the
   * (expensive, Redis-touching) restore for the overwhelming majority.
   *
   * `keepLadder` decides what the NEXT sweep does, and the two callers need opposite things.
   *  - A PAYMENT clears the ladder (default): the episode is over, and a later lapse deserves the
   *    full three warnings again.
   *  - A PLATFORM OVERRIDE keeps it. Resetting there is not a tidier record, it is a loophole: the
   *    sweep can only suspend at `stage >= 3`, so a zeroed ladder buys the tenant another ~2 days of
   *    free service AND mails them a fresh "your fleet stops tomorrow" — every click, unbounded.
   *    With the ladder kept, the next sweep re-suspends immediately and quietly, which is exactly
   *    what the button's own copy promises.
   */
  unsuspend(tenantId: string, opts?: { keepLadder?: boolean }): Promise<boolean>
}

/**
 * Why a subscription webhook did or did not change anything.
 * - `applied`  — the tenant row was updated.
 * - `stale`    — the tenant EXISTS but a guard dropped the event (older/replayed/same-second, or a
 *                late non-live event against a live subscription). Normal operation, not an error.
 * - `no_tenant`— no row carries that `stripeCustomerId`: someone is paying and has no plan.
 */
export type SubscriptionApplyResult = 'applied' | 'stale' | 'no_tenant'

/** Same lapse episode? Both null counts as the same (an unknown date is not a new lapse). */
const sameEpisode = (recordedFor: Date | null, lapsedAt: Date | null): boolean =>
  recordedFor === null || lapsedAt === null ? recordedFor === lapsedAt : recordedFor.getTime() === lapsedAt.getTime()

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
        // `emailVerifiedAt` is deliberately LEFT NULL — this is the one path that creates a user for
        // an address nobody has proven. Until the link in the welcome mail is clicked the account
        // cannot authenticate, which is what stops the free branch of signup from answering "does
        // this address exist" through a follow-up login (audit MED #67).
        const user = await tx.user.create({
          // `emailVerifiedAt: null` is EXPLICIT, not omitted: the column carries a DB-side
          // `DEFAULT now()` for the rolling-deploy window, so leaving it out would silently verify
          // the one account that must prove itself.
          data: { tenantId: tenant.id, accountId: null, email: data.email, passwordHash: data.passwordHash, role: 'tsp_admin', locale: data.locale ?? 'en', emailVerifiedAt: null },
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
        select: { stripeCustomerId: true, stripeSubscriptionId: true, subscriptionStatus: true, currentPeriodEnd: true, suspendedAt: true },
      })
      if (row === null) return null
      return {
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        subscriptionStatus: row.subscriptionStatus,
        currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
        suspendedAt: row.suspendedAt?.toISOString() ?? null,
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
                // SAME SECOND. Two disjoint cases, because rank is a per-SUBSCRIPTION lifecycle
                // order living in a per-CUSTOMER row — the mistake that has to be kept out of this
                // predicate is letting one subscription's rank order another's events.
                //
                //  1. SAME subscription → ordinary lifecycle order: admit a type ranking at or above
                //     the one already applied, so a reordered `.updated` cannot walk back a
                //     `.deleted`. `lte`, not `lt`: two same-second `.updated`s — what a plan change
                //     emits — must both land. (Equal ranks are therefore applied in ARRIVAL order;
                //     nothing in the payloads distinguishes them.) A NULL rank is not admitted: rows
                //     predating the column carry `lastBillingEventAt` with no rank, and admitting
                //     those reopens the resurrected-cancel bug for Stripe's whole retry horizon after
                //     deploy. The migration backfills them to 2; this is the belt to those braces.
                //
                //  2. A RESUBSCRIBE: a LIVE event for a DIFFERENT subscription, and the stored
                //     subscription is NOT live. `.deleted`(A) followed in the same second by
                //     `.created`(B) is a cancel-and-resubscribe in the CORRECT order, and rank alone
                //     dropped it — leaving the paying customer on the canceled subscription, floored
                //     to zero entitlements and, because `listActiveSubscribers` reads the same
                //     status, not even metered.
                //
                // The "stored is not live" half of (2) is what stops the three-event wedge:
                // `deleted(A) → created(B,active) → updated(A,active)`, all in one second, used to
                // end up ACTIVE on the DELETED sub_A — and unrecoverable, because every later sub_B
                // event is non-live and blocked by the per-subscription guard while sub_A, being
                // deleted, emits nothing ever again. Free unlimited service, invisible to both the
                // lapse sweep and the meter.
                {
                  AND: [
                    { lastBillingEventAt: eventAt },
                    {
                      OR: [
                        {
                          AND: [
                            data.stripeSubscriptionId === null ? { stripeSubscriptionId: null } : { stripeSubscriptionId: data.stripeSubscriptionId },
                            { lastBillingEventRank: { lte: rank } },
                          ],
                        },
                        ...(incomingLive && data.stripeSubscriptionId !== null
                          ? [
                              {
                                AND: [
                                  // `{ not: X }` does NOT match NULL in Prisma, so the null case is explicit
                                  { OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: { not: data.stripeSubscriptionId } }] },
                                  { OR: [{ subscriptionStatus: null }, { subscriptionStatus: { notIn: ['active', 'trialing'] } }] },
                                ],
                              },
                            ]
                          : []),
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
          // a LIVE subscription ends the lapse episode outright: clear the ladder here as well as in
          // `unsuspend`, because the majority path is a customer paying BEFORE they are cut off,
          // which never reaches unsuspend at all
          ...(incomingLive ? { lapseNoticeStage: 0, lapseNoticeFor: null } : {}),
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
    tenantIdForCustomer: async (stripeCustomerId) => (await prisma.tenant.findFirst({ where: { stripeCustomerId }, select: { id: true } }))?.id ?? null,
    isSuspended: async (tenantId) => (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { suspendedAt: true } }))?.suspendedAt != null,
    listSuspended: async () => {
      const rows = await prisma.tenant.findMany({ where: { suspendedAt: { not: null } }, select: { id: true, suspendedAt: true } })
      return rows.map((r) => ({ tenantId: r.id, suspendedAt: r.suspendedAt! }))
    },
    registryDevicesFor: async (tenantId) => {
      // the same shape the boot rehydrate builds, so a restore leaves the registry exactly as a
      // restart would: presence rules come from the PROFILE, odometerSource from the device
      const rows = await prisma.device.findMany({
        where: { tenantId, retiredAt: null },
        select: { id: true, imei: true, tenantId: true, accountId: true, profileId: true, odometerSource: true },
      })
      if (rows.length === 0) return []
      const profiles = new Map(
        (await prisma.deviceProfile.findMany({ select: { id: true, presenceRules: true, avlTable: true } })).map((p) => [p.id, p]),
      )
      return rows.map((r) => ({
        id: r.id,
        imei: r.imei,
        tenantId: r.tenantId,
        accountId: r.accountId,
        presenceRules: profiles.get(r.profileId)?.presenceRules ?? {},
        odometerSource: r.odometerSource,
        // a device whose profile row vanished is not a reason to decode it as nothing — the worker
        // treats an unknown table as the fallback, so name the fallback explicitly rather than ''
        avlTable: profiles.get(r.profileId)?.avlTable ?? 'fmb120',
      }))
    },
    markLapseNotice: async (tenantId, stage, forLapse) => {
      // MONOTONIC within the episode: two sweeps that both read stage 0 must not both mail notice 1.
      // A different episode always writes (the `OR` below), which is how the ladder restarts.
      await prisma.tenant.updateMany({
        where: { id: tenantId, OR: [{ lapseNoticeFor: forLapse === null ? undefined : { not: forLapse } }, { lapseNoticeStage: { lt: stage } }] },
        data: { lapseNoticeStage: stage, lapseNoticeFor: forLapse },
      })
    },
    suspend: async (tenantId, at) => {
      // CONDITIONAL on `suspendedAt: null`, so two workers (or a retry) cannot both count the same
      // tenant as newly cut off — the number in the log and the metric is tenants, not attempts.
      const r = await prisma.tenant.updateMany({ where: { id: tenantId, suspendedAt: null }, data: { suspendedAt: at } })
      return r.count > 0
    },
    unsuspend: async (tenantId, opts = {}) => {
      // On a PAYMENT the ladder resets with the suspension. This is belt to `lapseNoticeFor`'s
      // braces: that field already makes a stale stage read as zero, but leaving a spent ladder on a
      // paying tenant's row is state nobody would expect to find there. On a platform OVERRIDE the
      // ladder survives — see the interface note; zeroing it there is a free-service lever.
      const clearLadder = opts.keepLadder !== true
      const r = await prisma.tenant.updateMany({
        where: { id: tenantId, suspendedAt: { not: null } },
        data: { suspendedAt: null, ...(clearLadder ? { lapseNoticeStage: 0, lapseNoticeFor: null } : {}) },
      })
      return r.count > 0
    },
    pruneUnverifiedSignups: async (cutoff, limit = 500) => {
      const size = Math.min(Math.max(Math.trunc(limit), 1), 5_000)
      // Deliberately ONE bounded pass per run rather than a drain loop: this deletes tenants, and a
      // predicate bug that ran unbounded would take the platform with it. 500/day is far above any
      // real abandonment rate, and whatever is left is picked up tomorrow.
      //
      // The four conditions are the whole safety argument, and each is load-bearing:
      //   * created before the cutoff — an in-flight signup must have time to click the link;
      //   * at least one user, and NONE verified — a tenant with a verified user has a real owner;
      //   * no devices — someone got far enough to register hardware, whatever the user state;
      //   * no commissions — the payout ledger is a financial record and its FK is RESTRICT, so a
      //     match here would throw rather than delete (tenants.remove raises the same guard).
      // Users, accounts and the rest cascade from the tenant row.
      // The predicates live INSIDE the sub-select, and that is the whole point of the shape. With
      // `id IN (SELECT id FROM tenants ORDER BY createdAt LIMIT n)` the limit picked the n globally
      // OLDEST tenants — which are the real customers, who can never match — so once the platform had
      // more than n tenants the sweep became a permanent no-op and every squatted address was held
      // forever. Measured: 3 older verified tenants + 1 abandoned signup at limit 3 deleted nothing.
      // Here the limit is a BATCH SIZE over the matching set, which is what "picked up tomorrow" needs.
      return await prisma.$executeRaw`
        DELETE FROM tenants
         WHERE id IN (
           SELECT t.id FROM tenants t
            WHERE t."createdAt" < ${cutoff}
              AND EXISTS (SELECT 1 FROM users u WHERE u."tenantId" = t.id)
              AND NOT EXISTS (SELECT 1 FROM users u WHERE u."tenantId" = t.id AND u."emailVerifiedAt" IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM devices d WHERE d."tenantId" = t.id)
              AND NOT EXISTS (SELECT 1 FROM commissions c WHERE c."tenantId" = t.id)
            ORDER BY t."createdAt"
            LIMIT ${size})`
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
        select: {
          id: true,
          name: true,
          plan: true,
          subscriptionStatus: true,
          currentPeriodEnd: true,
          lastBillingEventAt: true,
          stripeSubscriptionId: true,
          suspendedAt: true,
          lapseNoticeStage: true,
          lapseNoticeFor: true,
          // the tenant ADMIN is who a billing notice belongs to — not an account manager or a
          // viewer, who can do nothing about it. Oldest first: on a self-serve signup that is the
          // person who created the tenant.
          users: { where: { role: 'tsp_admin' }, orderBy: { createdAt: 'asc' }, take: 1, select: { email: true, locale: true } },
        },
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
          suspendedAt: r.suspendedAt,
          // the stage counts ONLY when it was recorded against THIS lapse. A customer who walked the
          // whole ladder and then paid on day +2 — before suspension — would otherwise keep stage 3
          // forever and be cut off on their next lapse with no warnings at all.
          noticeStage: sameEpisode(r.lapseNoticeFor, trialExpired ? r.currentPeriodEnd : r.lastBillingEventAt) ? r.lapseNoticeStage : 0,
          contactEmail: r.users[0]?.email ?? null,
          contactLocale: r.users[0]?.locale ?? 'en',
        }
      })
    },
  }
}
