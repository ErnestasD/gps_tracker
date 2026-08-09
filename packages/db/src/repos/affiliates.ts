import type { Affiliate, AffiliateStatus, Commission, CommissionStatus, DealRegistration, PrismaClient } from '@prisma/client'

/**
 * An affiliate as the API may return it — the model MINUS `passwordHash` (argon2id, partner
 * self-service login). Enforced by the type system rather than by remembering to redact: the read
 * paths returned the raw model, so `GET /v1/affiliates` handed a platform_admin every partner's
 * password hash. Partners are third parties, not staff. Audit MED.
 */
export type AffiliateView = Omit<Affiliate, 'passwordHash'>

import { isUniqueViolation } from '../errors.js'
import type { Actor } from '../scope.js'
import type { AuditRepo } from './audit.js'

/**
 * A unique-constraint clash on create: `field` says WHICH one (email/code) so the caller can react
 * — an auto-generated code collision is retryable (regenerate), an email clash never is. Mapped to
 * 409 by the route; ANY other error propagates to the API's 500 net (rule 2 — apps/* can't import
 * @prisma/client, so the repo owns the P2002 → domain-error translation, mirroring DuplicateImeiError).
 */
export class AffiliateConflictError extends Error {
  constructor(readonly field: 'email' | 'code' | 'other') {
    super(`affiliate ${field} already in use`)
    this.name = 'AffiliateConflictError'
  }
}
// P2002 tells us which unique index clashed via meta.target — inspect it to pick the field
const conflictField = (err: unknown): 'email' | 'code' | 'other' => {
  // Prisma P2002 meta.target is a string OR string[] (e.g. ['email'] or 'affiliates_code_key')
  const raw = (err as { meta?: { target?: unknown } }).meta?.target
  const target = (Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : '').toLowerCase()
  if (target.includes('email')) return 'email'
  if (target.includes('code')) return 'code'
  return 'other'
}

export interface AffiliateCreate {
  name: string
  email: string
  code: string
  commissionPct?: number
  commissionMonths?: number
}
export interface AffiliateUpdate {
  name?: string
  status?: AffiliateStatus
  commissionPct?: number
  commissionMonths?: number
  /** the partner's own language for the mail we send them (en|lt|de|pl) */
  locale?: string
}

/** A commission accrued from a referred tenant's payment (idempotent on the source Stripe invoice). */
export interface CommissionAccrual {
  affiliateId: string
  tenantId: string
  amountCents: number
  currency: string
  sourceInvoiceId: string
  /** the rate applied, SNAPSHOTTED — editing the affiliate later must never re-price history (§6.9) */
  ratePct?: string
  /** the customer payment this was computed from, so the partner can check the arithmetic */
  baseAmountCents?: number
  /** when the customer actually paid (Stripe's clock), not when we inserted the row */
  paidAt?: Date
}

/** A settled Stripe invoice for a referred tenant — the webhook hands this to accrueForPaidInvoice,
 *  which resolves the referral + window + rate and accrues a commission idempotently. */
export interface PaidInvoice {
  stripeCustomerId: string
  invoiceId: string
  amountPaidCents: number
  currency: string
  /** the payment time (Stripe event.created) — the window is measured against THIS, not the server clock */
  paidAt: Date
}

/** Add whole months in UTC, clamping to the last valid day (e.g. Jan-31 +1mo → Feb-28). The commission
 *  window is month-coarse, so UTC month math is exact enough (no DST/render-zone concern — rule #7). */
function addMonthsUtc(d: Date, months: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + months
  const day = d.getUTCDate()
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate() // day 0 of next month = last day of target
  return new Date(Date.UTC(y, m, Math.min(day, lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()))
}

/** A partner's ledger read is unbounded by nature (one row per customer invoice, forever). Cap it so
 *  a long-lived partner's dashboard load stays a fixed cost; the page is a summary, not an export. */
const PARTNER_LEDGER_LIMIT = 500

/**
 * IS THIS TENANT COLD? — the house-account predicate, stated as what may be claimed rather than what
 * may not, because the safe default on a money rule is to refuse.
 *
 * The first cut asked "has this tenant paid?" and got it backwards. Both signals it used are
 * STRIPE-SHAPED: `commissionAnchorAt` is written only for tenants that already carry a referral, and
 * `subscriptionStatus` is written only by the Stripe webhook — so a tenant created by an admin and
 * invoiced outside Stripe has NULL for both. That is not an edge case, it is the sales-led TSP
 * customer: the largest accounts on the platform were invisible to a rule whose entire purpose is to
 * stop a partner earning commission on business we already have.
 *
 * COALESCE is load-bearing, not tidiness. `subscriptionStatus` is NULL for exactly the tenants this
 * rule was rewritten to catch, and `NULL = 'trialing'` is NULL, so `NOT (NULL AND …)` is NULL — which
 * a FILTER clause treats as false. The first version of this predicate therefore let through the
 * very customers it was inverted to protect, silently. The test that caught it is the one asserting
 * an admin-provisioned tenant is refused.
 *
 * Inverted, only one thing is claimable: a LOCAL SELF-SERVE TRIAL — `trialing` with no Stripe
 * subscription behind it, the same discriminator `effectiveEntitlementsAt` uses to tell a local
 * trial from a Stripe one. Someone at the company starting a trial by themselves is the commonest
 * way a partner's own prospect appears in our database before they register it, and that case stays
 * open. Everything else is ours until a human says otherwise.
 */
const COLD_TENANT_SQL = `(COALESCE(t."subscriptionStatus", '') = 'trialing' AND t."stripeSubscriptionId" IS NULL AND t."commissionAnchorAt" IS NULL)`

/** Claims are a queue a human works through, not an archive — bound the read like the ledger. */
const DEAL_LIST_LIMIT = 500

/** Stripe's subscription vocabulary → the three states a partner is entitled to. See PartnerCustomerRow.state. */
function customerState(status: string | null): 'trial' | 'active' | 'ended' {
  if (status === 'trialing') return 'trial'
  // past_due/unpaid are LIVE subscriptions in arrears — still earning, and the arrears are the
  // customer's business, not the partner's
  if (status === 'active' || status === 'past_due' || status === 'unpaid') return 'active'
  if (status === null) return 'trial' // signed up, never subscribed
  return 'ended'
}

/**
 * Affiliate/partner program repo (W9) — PLATFORM level (only platform_admin reaches the management
 * routes), so like the tenants repo it takes an Actor for audit but NO tenant scope. `getByCode` is
 * the ONE method the (unauthenticated) public signup path uses, to attribute a new tenant to a
 * referral code — it returns only ACTIVE affiliates so a pending/suspended code never attributes.
 */
/** One commission, told as a sentence: this customer paid this, at this rate, so you earned this. */
export interface PartnerCommissionRow {
  id: string
  customer: string
  amountCents: number
  baseAmountCents: number | null
  ratePct: string | null
  currency: string
  status: CommissionStatus
  sourceInvoiceId: string
  /** when the CUSTOMER paid (Stripe's clock), falling back to the row's own creation */
  at: string
}

/** Money for one customer in ONE currency. A tenant that re-subscribed in another currency has two
 *  of these; summing across them would invent an exchange rate we do not have. */
export interface PartnerCurrencyTotal {
  currency: string
  /** the customer payments that produced a commission — NOT their lifetime spend (see the field note
   *  on `totals` for why those differ) */
  commissionableCents: number
  earnedCents: number
}

/** A referred customer as the partner may see them. */
export interface PartnerCustomerRow {
  id: string
  name: string
  plan: string
  /**
   * DELIBERATELY COARSE: `trial` | `active` | `ended`, never Stripe's raw status.
   *
   * A partner needs to know whether they are still earning from this customer. They do not need to
   * know that the customer is `past_due` or `unpaid` — that is credit information about a third
   * party, disclosed to an affiliate the customer never agreed to share it with. `past_due` maps to
   * `active` because the subscription is live and a payment may still land.
   */
  state: 'trial' | 'active' | 'ended'
  /** their first paid invoice — the moment the earning window started */
  since: string | null
  /** when the window closes; null while they have never paid */
  windowEndsAt: string | null
  windowOpen: boolean
  /**
   * One entry per currency, empty until their first commissionable payment.
   *
   * `commissionableCents` is the sum of the invoices that ACCRUED a commission, which is not the
   * same as everything the customer has ever paid us: payments outside the window, or made while the
   * affiliate was suspended, produce no row and are not counted. Labelling it "what they paid" would
   * be false the day after a window closes, so the column says what it is.
   */
  totals: readonly PartnerCurrencyTotal[]
}

/** One partner's funnel — the four stages, plus the daily click series behind the first. */
export interface AffiliateFunnel {
  /** unique visitors who opened the short link, all time */
  clicksTotal: number
  /** …and in the last 30 UTC days, which is the number that says whether they are active NOW */
  clicks30: number
  /** pilot enquiries carrying their code */
  leads: number
  /** tenants attributed to them, whatever state */
  signups: number
  /** …of those, how many have ever paid an invoice */
  paying: number
}

/** What a partner is worth, per currency. Money is never summed across currencies (we have no rate). */
export interface AffiliateMoney {
  currency: string
  /** everything accrued and not reversed */
  earnedCents: number
  /** already transferred to the partner */
  paidCents: number
  /** confirmed, owed, not yet transferred — the number a payout run works from */
  pendingCents: number
}

/** The registry line an admin actually needs: who they are AND what they have produced. */
export interface AffiliateWithStats extends AffiliateView {
  stats: {
    /** tenants attributed to this partner, whatever state they are in */
    customers: number
    /** …of those, how many have never paid (still a trial, or signed up and stopped) */
    notPaying: number
    /** …and how many are still inside their earning window — the only ones producing money */
    earning: number
    money: readonly AffiliateMoney[]
  }
}

/** How long an approved claim protects a prospect. Ninety days is one sales cycle for a fleet. */
export const DEAL_WINDOW_DAYS = 90

export interface DealCreateInput {
  affiliateId: string
  company: string
  domain: string
  contactName?: string | undefined
  contactEmail?: string | undefined
  note?: string | undefined
}

/**
 * What we already have at a domain — the HOUSE ACCOUNT test.
 *
 * Deal registration protects NEW business. A prospect who is already our paying customer is not new
 * business by any reading, and paying commission on their next invoice is revenue we were already
 * earning. The same is true of an account another partner already owns.
 *
 * A domain carrying only unattributed, non-paying accounts is deliberately NOT blocked: someone at
 * the company starting a trial by themselves is the commonest way a partner's own prospect shows up
 * in our database before the partner gets round to registering them, and refusing on that basis
 * punishes the honest case.
 */
export interface DomainStanding {
  /** verified accounts whose address is at this domain */
  accounts: number
  /** …belonging to a tenant that is NOT a claimable local trial — i.e. already ours */
  houseAccounts: number
  /** …belonging to a tenant attributed to a DIFFERENT partner */
  otherPartnerAccounts: number
}

/** Raised when a partner claims a domain another partner already holds. First approved claim wins. */
export class DealDomainTakenError extends Error {
  constructor() {
    super('domain already claimed')
    this.name = 'DealDomainTakenError'
  }
}

export interface AffiliateRepo {
  list(): Promise<AffiliateView[]>
  get(id: string): Promise<AffiliateView | null>
  /** Attribution lookup for public signup: an ACTIVE affiliate by referral code, else null. */
  /** INTERNAL ONLY (signup attribution + commission accrual) — returns the FULL model including
   *  `passwordHash`, so it must never be piped to a response. The API-facing reads return
   *  {@link AffiliateView}. */
  getActiveByCode(code: string): Promise<Affiliate | null>
  create(actor: Actor, data: AffiliateCreate): Promise<AffiliateView>
  update(actor: Actor, id: string, data: AffiliateUpdate): Promise<AffiliateView | null>
  /** Accrue a commission, idempotent on sourceInvoiceId (a webhook retry is a no-op → returns null). */
  accrueCommission(data: CommissionAccrual): Promise<Commission | null>
  /**
   * Webhook path (F4): a referred tenant paid an invoice → accrue the partner's commission. Returns
   * the Commission, or null when nothing is owed: no referral, the affiliate isn't active, the payment
   * falls OUTSIDE the commissionMonths window (measured from the tenant's FIRST payment), a non-positive
   * amount, or a duplicate invoice (idempotent). All lookups + window math live here (rule 2).
   */
  accrueForPaidInvoice(invoice: PaidInvoice): Promise<Commission | null>
  /**
   * The admin registry: every partner WITH what they have produced.
   *
   * The plain list showed a name, a code and a percentage — nothing that answers "is this partner
   * worth anything?", which is the only question the page exists for. Three grouped queries for the
   * whole table, not one per row: the aggregates come from two groupBys and one projection of the
   * referred tenants, so adding a partner does not add a query.
   */
  listWithStats(): Promise<AffiliateWithStats[]>
  /**
   * Count ONE unique click on a partner's short link, for the given UTC day.
   *
   * Idempotency (one visitor per code per day) is the CALLER's job via Redis — this is the durable
   * counter, and it upserts rather than inserting a row per hit.
   */
  recordClick(affiliateId: string, day: Date): Promise<void>
  /** The four funnel stages for one partner. */
  funnelFor(affiliateId: string, code: string, now: Date): Promise<AffiliateFunnel>
  // ── deal registration (§6.9) ──────────────────────────────────────────────────────────────────
  /** A partner claims a prospect. Always lands as `pending` — approval is a human decision. */
  createDeal(data: DealCreateInput): Promise<DealRegistration>
  /** How many of a partner's claims are still awaiting a decision — the outstanding-queue cap. */
  countPendingDeals(affiliateId: string): Promise<number>
  /**
   * The house-account test for one domain, from the point of view of ONE partner.
   *
   * `forAffiliateId` is what makes "another partner's account" answerable: a domain already
   * attributed to the claimant is not a reason to refuse them.
   */
  domainStanding(domain: string, forAffiliateId: string): Promise<DomainStanding>
  /** One partner's own claims, newest first. */
  listDealsForPartner(affiliateId: string): Promise<DealRegistration[]>
  /**
   * Every claim, for the admin queue — PENDING FIRST, because those are the only rows that need
   * anything from anyone, and a partner filing junk claims must not be able to push a competitor's
   * pending one off the end of the page.
   *
   * Each row carries the facts the decision turns on and which the queue had no way to show: the
   * domain's STANDING (is this already our customer, or another partner's?) and the claiming
   * partner's own email domain (is this a self-referral wearing a second domain?).
   *
   * Standing is shown, NOT enforced here. The registration endpoint refuses the obvious cases so a
   * partner learns the rule immediately, but the test is a heuristic over email domains and it will
   * be wrong sometimes — a customer whose staff use a different domain, a reseller's sub-account
   * user carrying their own. Making it terminal at approval would leave a human with a claim they
   * can see is legitimate and no way to say so, which is the opposite of why this queue exists.
   */
  listDeals(): Promise<(DealRegistration & { affiliateName: string; affiliateEmailDomain: string; standing: DomainStanding })[]>
  /**
   * Approve or reject a pending claim.
   *
   * APPROVAL IS EXCLUSIVE: it refuses (DealDomainTakenError) when another partner already holds a
   * live claim on the same domain. Two partners both told "this prospect is protected for you" is
   * worse than one of them being told no — the promise is the product here, and a duplicate would be
   * discovered only when the money was already owed twice.
   */
  decideDeal(actor: Actor, id: string, status: 'approved' | 'rejected', reason: string | undefined, now: Date): Promise<DealRegistration | null>
  /**
   * The partner protecting this email domain right now, if any.
   *
   * Signup calls this ONLY when no referral code was supplied — an explicit link is the customer's
   * own action at the moment of signing up, and it wins. A claim covers the case the whole feature
   * exists for: the customer arrives by typing our address into a browser.
   *
   * Oldest live claim wins, so the answer cannot change under a concurrent approval.
   */
  claimFor(domain: string, now: Date): Promise<DealRegistration | null>
  /**
   * Record that a claim produced a tenant — WITHOUT spending it.
   *
   * It used to flip the claim to `converted`, and `claimFor` only matches `approved`, so the first
   * tenant row on that domain ended the protection. That is reachable by anyone: `POST
   * /v1/public/signup` with `ops@bigfleet.lt` creates a tenant before any address is verified, the
   * activation mail goes to the real customer who never clicks it, `pruneUnverifiedSignups` deletes
   * the tenant — and the partner's ninety days are gone, burnt by a stranger or by one employee who
   * abandoned a form. A competitor could do it deliberately for every contested prospect.
   *
   * The claim stays `approved` for its full window, so a customer's later (or second) signup is
   * still attributed. `convertedTenantId` is stamped once, by the first signup, purely so the
   * partner can see it landed.
   */
  markDealConverted(id: string, tenantId: string, now: Date): Promise<void>
  listCommissions(affiliateId?: string): Promise<Commission[]>
  /**
   * A refunded customer payment reverses the commission it earned (Stripe `charge.refunded`).
   *
   * Only a still-PENDING commission is voided. One already marked `paid` is money that has left our
   * bank into the partner's, and flipping it to `void` would silently create a debt the partner
   * never sees and we never chase — that is a conversation, not a database write, so it returns
   * `alreadyPaid` and leaves the row alone for a human.
   *
   * WHEN NO COMMISSION EXISTS YET it writes a zero-amount void TOMBSTONE rather than shrugging.
   * Stripe does not guarantee event order, and our own accrual path returns 500-and-retry on a DB
   * fault — so `charge.refunded` really can arrive before the `invoice.payment_succeeded` it
   * reverses. Without the tombstone the retry then accrues a commission on money the customer
   * already has back, and nothing ever revisits it. The tombstone takes the row's unique
   * `sourceInvoiceId`, so the late accrual hits the same idempotency guard as a duplicate delivery.
   * `stripeCustomerId` is what resolves the tenant/affiliate the tombstone must belong to.
   */
  voidCommissionForRefund(sourceInvoiceId: string, stripeCustomerId: string): Promise<'voided' | 'alreadyPaid' | 'tombstoned' | 'none'>
  /**
   * The partner's own view: every commission WITH the customer it came from and the invoice it was
   * calculated on. The portal previously listed an amount, a status and a raw Stripe invoice id —
   * a partner could see that they had earned €90 and nothing about which customer, which month, or
   * what the customer actually paid, which is not a statement anyone can check.
   *
   * The customer's NAME and the INVOICE TOTAL are the boundary: they are the basis of the money
   * owed, so a partner is entitled to them. Everything else about that tenant — its users, devices,
   * contacts — is not, and is not selected here.
   */
  listCommissionsForPartner(affiliateId: string): Promise<PartnerCommissionRow[]>
  /** The customers a partner introduced, with what they have paid, what it earned, and when the
   *  earning window closes — the questions a partner actually asks. */
  listReferredCustomers(affiliateId: string): Promise<PartnerCustomerRow[]>
  setCommissionStatus(actor: Actor, id: string, status: CommissionStatus): Promise<Commission | null>

  // ── partner self-service auth (F5) — UNSCOPED by design (a partner is not a tenant user) ──────────
  /** Login lookup by email (partner sign-in). Returns the hash + status so the caller can argon2-verify
   *  and refuse a non-active partner. Null when no such affiliate. */
  findByEmailForAuth(email: string): Promise<{ id: string; email: string; passwordHash: string | null; status: AffiliateStatus } | null>
  setPassword(id: string, passwordHash: string): Promise<void>
  /** Issue a one-time set/reset-password token (store only its hash). */
  createPwToken(affiliateId: string, tokenHash: string, expiresAt: Date): Promise<void>
  /**
   * Issue a token AND burn every older unused one, atomically.
   *
   * The admin UI says a new link invalidates the previous one, and for a while it did not: minting
   * only created, so every link an admin had ever generated stayed valid for its full TTL. An admin
   * pasting a link into the wrong chat and re-minting to "revoke" it would have left the leaked one
   * working — and that link sets a password on the partner portal, which shows referred customers'
   * names and revenue. Invalidate-then-create in ONE transaction, so two concurrent mints cannot
   * interleave into a state where the surviving token is not the one the admin is looking at.
   */
  replacePwToken(affiliateId: string, tokenHash: string, expiresAt: Date, now: Date): Promise<void>
  /** Consume a token atomically (single-use, unexpired) → the affiliate id, or null. */
  consumePwToken(tokenHash: string, now: Date): Promise<string | null>
  /** Burn every still-unused token for an affiliate (after a successful set, so no sibling link works). */
  invalidatePwTokens(affiliateId: string, now: Date): Promise<void>
}

/**
 * Every field the API may return for an affiliate. EXPLICIT, not `findMany()` — the model carries
 * `passwordHash` (argon2id, for the partner self-service login), and the read paths piped the raw
 * row straight to the client, so `GET /v1/affiliates` handed a platform_admin every partner's
 * password hash in the JSON. Partners are THIRD PARTIES, not staff. The codebase already solved
 * this shape twice (webhooks' `readRedact: ['secret']`, partner.ts's hand-picked fields); the
 * affiliate repo was the one that forgot. A `select` rather than a delete-after-read, so a field
 * added to the model later is opt-IN and cannot leak by default (rule 12). Audit MED.
 */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  code: true,
  commissionPct: true,
  commissionMonths: true,
  status: true,
  locale: true,
  createdAt: true,
} as const

/**
 * AUDIT (audit MED). This repo was the only mutating one constructed WITHOUT the audit repo, and it
 * shows in the code it left behind: `create`/`update` accepted an `Actor` and ignored it, `update`
 * read `before` and used it only for a null check, and `setCommissionStatus` took no actor at all.
 * These are the money controls — the payout percentage, the commission window, and the paid/void
 * mark on an individual accrual — and they were mutable with no trace of who or when. A commission
 * dispute with a partner had nothing to reconstruct.
 */
export function createAffiliateRepo(prisma: PrismaClient, audit: AuditRepo): AffiliateRepo {
  // named so listDeals can reuse domainStanding rather than carrying a second copy of the predicate
  const repo: AffiliateRepo = {
    list: () => prisma.affiliate.findMany({ orderBy: { createdAt: 'desc' }, select: PUBLIC_SELECT }),
    listWithStats: async () => {
      const [affiliates, tenants, sums] = await Promise.all([
        prisma.affiliate.findMany({ orderBy: { createdAt: 'desc' }, select: PUBLIC_SELECT }),
        // O(referred tenants), NOT O(invoices): this projects three columns of the customer table,
        // which is bounded by how many customers the platform has, and is index-backed on
        // referredByAffiliateId. The per-tenant window math needs the anchor and the snapshotted
        // term, so it cannot collapse into a groupBy without raw SQL — and correctness that is
        // readable beats an aggregate nobody can check against the accrual it must match.
        prisma.tenant.findMany({
          where: { referredByAffiliateId: { not: null } },
          select: { referredByAffiliateId: true, commissionAnchorAt: true, commissionMonthsAtAnchor: true },
        }),
        // ordered so the currency chips do not swap places between refetches (the API test having to
        // sort before asserting was the tell that the order was Postgres', not ours)
        prisma.commission.groupBy({ by: ['affiliateId', 'currency', 'status'], _sum: { amountCents: true }, orderBy: [{ currency: 'asc' }] }),
      ])
      // the live term, for the one case where a tenant is anchored but carries no snapshot: the
      // ACCRUAL falls back to the affiliate's current commissionMonths and keeps paying, so
      // defaulting to 0 here would show a live obligation as expired. Not reachable today (both
      // columns are always written together) — it is the direction of the guess that matters.
      const liveMonths = new Map(affiliates.map((a) => [a.id, a.commissionMonths]))
      const activeAffiliates = new Set(affiliates.filter((a) => a.status === 'active').map((a) => a.id))
      const counts = new Map<string, { customers: number; notPaying: number; earning: number }>()
      const now = Date.now()
      for (const t of tenants) {
        const key = t.referredByAffiliateId
        if (key === null) continue // narrowed for the type; the where clause already excluded these
        const c = counts.get(key) ?? { customers: 0, notPaying: 0, earning: 0 }
        c.customers += 1
        if (t.commissionAnchorAt === null) c.notPaying += 1 // no anchor ⇒ never paid an invoice
        // SAME window function as the accrual and the partner portal — three readings of one term
        // would be three different answers (see listReferredCustomers). And the SAME status gate:
        // accrueForPaidInvoice refuses everything for a non-active affiliate BEFORE it looks at the
        // window, so a suspended partner has nobody earning, however open their customers' windows
        // are. Counting them anyway meant pressing Suspend did not move the number next to it.
        else if (
          activeAffiliates.has(key) &&
          addMonthsUtc(t.commissionAnchorAt, t.commissionMonthsAtAnchor ?? liveMonths.get(key) ?? 0).getTime() >= now
        ) {
          c.earning += 1
        }
        counts.set(key, c)
      }
      const money = new Map<string, Map<string, AffiliateMoney>>()
      for (const s of sums) {
        const amount = s._sum.amountCents ?? 0
        if (s.status === 'void') continue // reversals are not money; a total counting them is a lie
        const per = money.get(s.affiliateId) ?? new Map<string, AffiliateMoney>()
        const m = per.get(s.currency) ?? { currency: s.currency, earnedCents: 0, paidCents: 0, pendingCents: 0 }
        m.earnedCents += amount
        if (s.status === 'paid') m.paidCents += amount
        if (s.status === 'pending') m.pendingCents += amount
        per.set(s.currency, m)
        money.set(s.affiliateId, per)
      }
      return affiliates.map((a) => ({
        ...a,
        stats: {
          ...(counts.get(a.id) ?? { customers: 0, notPaying: 0, earning: 0 }),
          money: [...(money.get(a.id)?.values() ?? [])],
        },
      }))
    },
    get: (id) => prisma.affiliate.findUnique({ where: { id }, select: PUBLIC_SELECT }),
    // EXACT, case-insensitive match (audit HIGH). Prisma's `mode:'insensitive'` compiles to ILIKE
    // with the value bound UNESCAPED, so `_` — a LIKE single-char wildcard that the code charset
    // permits — let `?ref=______` match ANY 6-char active code and credit a nondeterministic
    // partner. Now attribution is reachable ANONYMOUSLY (public signup), so this is real money:
    // match on lower(code) = lower($1), backed by the functional unique index (migration
    // 20260803220000), with a deterministic order for safety.
    getActiveByCode: async (code) => {
      const rows = await prisma.$queryRaw<Affiliate[]>`
        SELECT * FROM "affiliates"
        WHERE lower("code") = lower(${code}) AND "status" = 'active'::"AffiliateStatus"
        ORDER BY "createdAt" ASC
        LIMIT 1`
      return rows[0] ?? null
    },
    create: async (actor, data) => {
      let created: AffiliateView
      try {
        created = await prisma.affiliate.create({
          select: PUBLIC_SELECT,
          data: {
            name: data.name,
            // normalized on WRITE: the login handler lowercases before the lookup, and
            // `email` is a case-sensitive @unique, so a mixed-case row could never log in
            // (migration 20260804200000 collapses existing rows + adds a functional unique)
            email: data.email.trim().toLowerCase(),
            code: data.code,
            ...(data.commissionPct !== undefined ? { commissionPct: data.commissionPct } : {}),
            ...(data.commissionMonths !== undefined ? { commissionMonths: data.commissionMonths } : {}),
          },
        })
      } catch (err) {
        if (isUniqueViolation(err)) throw new AffiliateConflictError(conflictField(err))
        throw err // a real DB fault must reach the API's 500 net, NOT masquerade as a conflict
      }
      // OUTSIDE the try on purpose: a unique violation from the audit insert must never be
      // translated into AffiliateConflictError, because the route RETRIES on that signal
      // (auto-generated code collisions) and the affiliate already exists by then
      await audit.recordPlatform(actor, { action: 'create', entity: 'affiliate', entityId: created.id, after: created })
      return created
    },
    update: async (actor, id, data) => {
      // `before` is the WHOLE point of an audit row on this table: commissionPct and
      // commissionMonths are the payout terms, and a silent edit is the difference between a
      // partner being paid 20% and 2% with nothing to point at afterwards.
      const before = await prisma.affiliate.findUnique({ where: { id }, select: PUBLIC_SELECT })
      if (before === null) return null
      const after = await prisma.affiliate.update({ where: { id }, data, select: PUBLIC_SELECT })
      await audit.recordPlatform(actor, { action: 'update', entity: 'affiliate', entityId: id, before, after })
      return after
    },
    accrueCommission: async (data) => {
      // ON CONFLICT (sourceInvoiceId) DO NOTHING semantics via a guarded create — a duplicate webhook
      // delivery for the same invoice must never double-pay the affiliate.
      try {
        return await prisma.commission.create({ data })
      } catch {
        return null // unique violation on sourceInvoiceId ⇒ already accrued
      }
    },
    accrueForPaidInvoice: async (invoice) => {
      const tenant = await prisma.tenant.findFirst({
        where: { stripeCustomerId: invoice.stripeCustomerId },
        select: { id: true, referredByAffiliateId: true, commissionAnchorAt: true, commissionMonthsAtAnchor: true },
      })
      if (tenant === null || tenant.referredByAffiliateId === null) return null // not a referred tenant
      const affiliate = await prisma.affiliate.findUnique({ where: { id: tenant.referredByAffiliateId } })
      if (affiliate === null) return null
      // Window: commissionMonths from the tenant's FIRST PAYMENT (schema §commissionMonths — a trial
      // must not eat the window). BOTH ends were derived, and both drifted (audit MED #26):
      //
      //  * the anchor was the earliest COMMISSION ROW, so a first payment that accrued nothing —
      //    the partner still `pending`/`suspended` at the time, or a 0% rate — left no row, and the
      //    window silently restarted at whichever later payment first produced one. A partner
      //    suspended for six months and reinstated got a fresh full term on a customer they had
      //    already been paid out on. (A zero-amount invoice is NOT in this set: `paidInvoiceFrom`
      //    drops `amount_paid <= 0` before the webhook ever calls this.)
      //  * `commissionMonths` was read LIVE, so editing it re-priced history in both directions:
      //    12 → 24 re-opened windows that closed a year of invoices ago and started paying again;
      //    24 → 12 retroactively closed windows a partner had already earned in. This is the exact
      //    mistake the `ratePct` snapshot two lines below exists to prevent — the term was simply
      //    left out of it.
      //
      // Both are now stamped on the TENANT at its first paid invoice and never recomputed. The stamp
      // happens BEFORE the affiliate-active check on purpose: the anchor is a fact about the customer's
      // payment history, not about whether anyone happened to earn on it.
      let anchorAt = tenant.commissionAnchorAt
      let months = tenant.commissionMonthsAtAnchor ?? affiliate.commissionMonths
      if (anchorAt === null) {
        // CONDITIONAL write: two invoices delivered concurrently must not each claim the anchor.
        // Whoever's `commissionAnchorAt: null` predicate still matches wins; the loser adopts it.
        const claimed = await prisma.tenant.updateMany({
          where: { id: tenant.id, commissionAnchorAt: null },
          data: { commissionAnchorAt: invoice.paidAt, commissionMonthsAtAnchor: affiliate.commissionMonths },
        })
        if (claimed.count > 0) {
          anchorAt = invoice.paidAt
          months = affiliate.commissionMonths
        } else {
          const fresh = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { commissionAnchorAt: true, commissionMonthsAtAnchor: true } })
          anchorAt = fresh?.commissionAnchorAt ?? invoice.paidAt
          months = fresh?.commissionMonthsAtAnchor ?? affiliate.commissionMonths
        }
      }
      // The back-move is UNCONDITIONAL, not the `else` of the claim above: when two first invoices
      // race, the loser adopts the winner's anchor — and if the loser is the EARLIER payment, the
      // window would stay pinned to the later one and the partner would earn past the agreed term.
      // (Measured: 2 of 3 concurrent Jan/Mar races kept March and paid an August invoice that a
      // 6-month window from January excludes.) The anchor is the FIRST payment, so it may move back,
      // never forward; the term stays as first snapshotted, since re-reading it here would put the
      // live value back in the path this whole block exists to remove.
      if (invoice.paidAt < anchorAt) {
        const moved = await prisma.tenant.updateMany({ where: { id: tenant.id, commissionAnchorAt: { gt: invoice.paidAt } }, data: { commissionAnchorAt: invoice.paidAt } })
        if (moved.count > 0) anchorAt = invoice.paidAt
        else {
          // someone moved it even earlier between our read and this write — take theirs
          const fresh = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { commissionAnchorAt: true } })
          anchorAt = fresh?.commissionAnchorAt ?? invoice.paidAt
        }
      }
      if (affiliate.status !== 'active') return null // suspended/pending ⇒ commissions stop (window still anchored)
      if (invoice.paidAt > addMonthsUtc(anchorAt, months)) return null
      // SNAPSHOT the rate with the entry (§6.9): reading it live meant an admin editing commissionPct
      // re-priced every still-open commission, and editing commissionMonths could reopen a closed window.
      const ratePct = affiliate.commissionPct
      const amountCents = Math.floor((invoice.amountPaidCents * Number(ratePct)) / 100)
      if (amountCents <= 0) return null // a $0 invoice / 100%-discount / zero-rate owes nothing
      // idempotent on the invoice id — a DUPLICATE delivery is a no-op (null); any OTHER fault rethrows
      // so a transient DB error is NOT mistaken for a dedupe (the webhook returns non-2xx → Stripe
      // retries → idempotency makes the retry safe, recovering the commission rather than losing it).
      try {
        return await prisma.commission.create({
          data: {
            affiliateId: affiliate.id, tenantId: tenant.id, amountCents, currency: invoice.currency,
            sourceInvoiceId: invoice.invoiceId,
            ratePct, baseAmountCents: invoice.amountPaidCents, paidAt: invoice.paidAt,
          },
        })
      } catch (err) {
        if (isUniqueViolation(err)) return null
        throw err
      }
    },
    recordClick: async (affiliateId, day) => {
      await prisma.affiliateClick.upsert({
        where: { affiliateId_day: { affiliateId, day } },
        create: { affiliateId, day, clicks: 1 },
        update: { clicks: { increment: 1 } },
      })
    },
    funnelFor: async (affiliateId, code, now) => {
      // 30 UTC days back, floored to midnight — the series is day-grained, so a partial first day
      // would make "last 30 days" mean 29 and a bit, differently every time the page is opened
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29))
      // ALL FIVE IN ONE Promise.all, on one snapshot. `paying` used to be awaited afterwards, so a
      // tenant that paid between the two reads produced paying > signups — which the portal renders
      // as a conversion above 100% on the last funnel step.
      const [all, recent, leads, signups, paying] = await Promise.all([
        prisma.affiliateClick.aggregate({ where: { affiliateId }, _sum: { clicks: true } }),
        prisma.affiliateClick.aggregate({ where: { affiliateId, day: { gte: from } }, _sum: { clicks: true } }),
        // EXACT lower(ref) = lower(code), the same rule attribution uses — Prisma's
        // `mode:'insensitive'` compiles to ILIKE, where a code containing `_` would match codes it
        // does not own. Backed by the functional index in migration 20260808110000; a plain index
        // on `ref` would not be used by this predicate.
        prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM leads WHERE lower(ref) = lower(${code})`,
        prisma.tenant.count({ where: { referredByAffiliateId: affiliateId } }),
        prisma.tenant.count({ where: { referredByAffiliateId: affiliateId, commissionAnchorAt: { not: null } } }),
      ])
      return {
        clicksTotal: all._sum.clicks ?? 0,
        clicks30: recent._sum.clicks ?? 0,
        leads: Number(leads[0]?.n ?? 0),
        signups,
        paying,
      }
    },
    createDeal: (data) =>
      prisma.dealRegistration.create({
        data: {
          affiliateId: data.affiliateId,
          company: data.company,
          domain: data.domain,
          ...(data.contactName !== undefined ? { contactName: data.contactName } : {}),
          ...(data.contactEmail !== undefined ? { contactEmail: data.contactEmail } : {}),
          ...(data.note !== undefined ? { note: data.note } : {}),
        },
      }),
    countPendingDeals: (affiliateId) => prisma.dealRegistration.count({ where: { affiliateId, status: 'pending' } }),
    domainStanding: async (domain, forAffiliateId) => {
      const rows = await prisma.$queryRawUnsafe<{ total: bigint; house: bigint; other: bigint }[]>(
        `SELECT
           count(*) AS total,
           count(*) FILTER (WHERE NOT ${COLD_TENANT_SQL}) AS house,
           count(*) FILTER (WHERE t."referredByAffiliateId" IS NOT NULL AND t."referredByAffiliateId" <> $2::uuid) AS other
         FROM users u
         JOIN tenants t ON t.id = u."tenantId"
         WHERE
           -- ONLY VERIFIED ACCOUNTS BLOCK. Public signup stamps referredByAffiliateId from ?ref and
           -- creates the user BEFORE anyone proves the address, and those rows live for thirty days.
           -- Counting them let a partner sign up one throwaway through their own link and lock every
           -- rival out of that domain for a month, renewably, while staying free to claim it
           -- themselves (their own attribution is excluded below).
           u."emailVerifiedAt" IS NOT NULL
           AND (
             split_part(lower(u.email), '@', 2) = $1
             -- …or the tenant SERVES that domain under its own white-label host, which is the same
             -- company by a different address: a customer paying as ops@bigfleet.com is not made a
             -- stranger by a partner claiming bigfleet.lt
             OR EXISTS (SELECT 1 FROM tenant_domains d WHERE d."tenantId" = t.id AND d.verified AND lower(d.domain) = $1)
           )
           -- a partner is never blocked by their OWN customers: re-claiming a domain they already
           -- brought is pointless, not fraudulent
           AND (t."referredByAffiliateId" IS NULL OR t."referredByAffiliateId" <> $2::uuid)`,
        domain,
        forAffiliateId,
      )
      const r = rows[0]
      return {
        accounts: Number(r?.total ?? 0),
        houseAccounts: Number(r?.house ?? 0),
        otherPartnerAccounts: Number(r?.other ?? 0),
      }
    },
    listDealsForPartner: (affiliateId) => prisma.dealRegistration.findMany({ where: { affiliateId }, orderBy: { createdAt: 'desc' }, take: DEAL_LIST_LIMIT }),
    listDeals: async () => {
      const rows = await prisma.dealRegistration.findMany({
        // pending first IN SQL — sorting client-side over a `take` window means a flood of new
        // claims silently drops older pending ones out of the only screen an admin has
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: DEAL_LIST_LIMIT,
        include: { affiliate: { select: { name: true, email: true } } },
      })
      if (rows.length === 0) return []
      // ONE query for every (domain, owner) pair on the page, not one per row
      const standings = await Promise.all(
        [...new Map(rows.map((r) => [`${r.domain}|${r.affiliateId}`, r])).values()].map(async (r) => ({
          key: `${r.domain}|${r.affiliateId}`,
          standing: await repo.domainStanding(r.domain, r.affiliateId),
        })),
      )
      const byKey = new Map(standings.map((x) => [x.key, x.standing]))
      return rows.map(({ affiliate, ...d }) => ({
        ...d,
        affiliateName: affiliate.name,
        affiliateEmailDomain: affiliate.email.slice(affiliate.email.lastIndexOf('@') + 1).toLowerCase(),
        standing: byKey.get(`${d.domain}|${d.affiliateId}`) ?? { accounts: 0, houseAccounts: 0, otherPartnerAccounts: 0 },
      }))
    },
    decideDeal: async (actor, id, status, reason, now) => {
      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.dealRegistration.findUnique({ where: { id } })
        if (before === null) return null
        // only a PENDING claim is decidable: re-approving a converted one would move its expiry and
        // silently re-open a window that has already paid out
        if (before.status !== 'pending') return null
        if (status === 'approved') {
          // A TRANSACTION IS NOT A LOCK. Prisma runs at Postgres' default READ COMMITTED, and the
          // check below is a plain read against a NON-unique index — so two admins approving
          // competing claims on the same domain each see "nothing live" (neither can see the
          // other's uncommitted UPDATE), each updates a DIFFERENT row, and both commit. Two
          // partners then hold written promises on one prospect, which is discovered when the money
          // is owed twice. The advisory lock serialises them on the domain itself.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${before.domain}))`
          const live = await tx.dealRegistration.findFirst({
            where: { domain: before.domain, status: 'approved', expiresAt: { gt: now }, NOT: { id } },
          })
          if (live !== null) throw new DealDomainTakenError()
        }
        const row = await tx.dealRegistration.update({
          where: { id },
          data: {
            status,
            ...(reason !== undefined ? { reason } : {}),
            reviewedAt: now,
            reviewedBy: actor.userId,
            ...(status === 'approved' ? { expiresAt: new Date(now.getTime() + DEAL_WINDOW_DAYS * 86_400_000) } : {}),
          },
        })
        // AUDITED IN THE SAME TRANSACTION. Written after the commit, a failing audit left the
        // approval standing and unrecorded while the admin saw an error saying it had not saved —
        // the worst of both. An approved claim attributes future signups to a partner, so who
        // approved it and when has to be answerable later, or not have happened at all.
        await tx.auditLog.create({
          data: {
            tenantId: null,
            userId: actor.userId,
            action: 'update',
            entity: 'deal_registration',
            entityId: id,
            after: { status: row.status, domain: row.domain, affiliateId: row.affiliateId, expiresAt: row.expiresAt?.toISOString() ?? null } as never,
          },
        })
        return row
      })
      return updated
    },
    claimFor: (domain, now) =>
      prisma.dealRegistration.findFirst({
        where: { domain, status: 'approved', expiresAt: { gt: now } },
        // OLDEST first: the answer must not depend on which of two live claims was written last
        orderBy: { createdAt: 'asc' },
      }),
    markDealConverted: async (id, tenantId, now) => {
      // `convertedTenantId: null` in the predicate: the FIRST signup stamps it and later ones do not
      // overwrite it. The status is deliberately NOT touched — see the interface note on why
      // spending the claim here hands a stranger the power to end a partner's protection.
      await prisma.dealRegistration.updateMany({
        where: { id, convertedTenantId: null },
        data: { convertedTenantId: tenantId, convertedAt: now },
      })
    },
    listCommissions: (affiliateId) =>
      prisma.commission.findMany({ where: affiliateId !== undefined ? { affiliateId } : {}, orderBy: { createdAt: 'desc' } }),
    listCommissionsForPartner: async (affiliateId) => {
      const rows = await prisma.commission.findMany({
        // a zero-amount void is a REFUND TOMBSTONE (see voidCommissionForRefund) — a marker that
        // stops a late accrual, never a line of the partner's ledger
        where: { affiliateId, NOT: { status: 'void', amountCents: 0 } },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        take: PARTNER_LEDGER_LIMIT,
        // ONLY the customer's display name — see the interface note on where the boundary is
        select: {
          id: true, amountCents: true, baseAmountCents: true, ratePct: true, currency: true,
          status: true, sourceInvoiceId: true, paidAt: true, createdAt: true,
          tenant: { select: { name: true } },
        },
      })
      return rows.map((r) => ({
        id: r.id,
        customer: r.tenant.name,
        amountCents: r.amountCents,
        baseAmountCents: r.baseAmountCents,
        ratePct: r.ratePct?.toString() ?? null,
        currency: r.currency,
        status: r.status,
        sourceInvoiceId: r.sourceInvoiceId,
        at: (r.paidAt ?? r.createdAt).toISOString(),
      }))
    },
    listReferredCustomers: async (affiliateId) => {
      const tenants = await prisma.tenant.findMany({
        where: { referredByAffiliateId: affiliateId },
        select: {
          id: true, name: true, plan: true, subscriptionStatus: true,
          commissionAnchorAt: true, commissionMonthsAtAnchor: true,
        },
        orderBy: { name: 'asc' },
      })
      if (tenants.length === 0) return []
      // one grouped pass rather than a query per tenant — a partner with fifty customers should not
      // cost fifty round trips on a page they refresh
      const sums = await prisma.commission.groupBy({
        by: ['tenantId', 'currency'],
        where: { affiliateId, status: { not: 'void' } },
        _sum: { amountCents: true, baseAmountCents: true },
      })
      // keyed by tenant AND currency — groupBy splits on both, so keying the map on tenantId alone
      // let a second currency overwrite the first and quietly delete that money from the page
      const byTenant = new Map<string, PartnerCurrencyTotal[]>()
      for (const s of sums) {
        const list = byTenant.get(s.tenantId) ?? []
        list.push({ currency: s.currency, commissionableCents: s._sum.baseAmountCents ?? 0, earnedCents: s._sum.amountCents ?? 0 })
        byTenant.set(s.tenantId, list)
      }
      const now = new Date()
      return tenants.map((t) => {
        const months = t.commissionMonthsAtAnchor
        // addMonthsUtc, NOT setUTCMonth: the accrual gate below uses addMonthsUtc, and setUTCMonth
        // OVERFLOWS where that clamps (31 Aug + 6mo → 3 Mar vs 28 Feb). Showing a partner a window
        // end three days after the one the accrual enforces is the support call this page exists to
        // prevent — the two must be the same function, not two implementations of the same idea.
        const ends = t.commissionAnchorAt !== null && months !== null ? addMonthsUtc(t.commissionAnchorAt, months) : null
        return {
          id: t.id,
          name: t.name,
          plan: t.plan,
          state: customerState(t.subscriptionStatus),
          since: t.commissionAnchorAt?.toISOString() ?? null,
          windowEndsAt: ends?.toISOString() ?? null,
          // INCLUSIVE, matching the accrual's `paidAt > end ⇒ closed`: a payment landing exactly on
          // the boundary still earns, so the portal must not call the window shut a day early
          // (no anchor yet ⇒ never paid, so it has not started and is certainly not closed)
          windowOpen: ends === null ? true : ends.getTime() >= now.getTime(),
          totals: byTenant.get(t.id) ?? [],
        }
      })
    },
    voidCommissionForRefund: async (sourceInvoiceId, stripeCustomerId) => {
      // no human actor: a webhook did this. Recorded as nobody rather than blamed on a placeholder.
      const system = { userId: null }
      const row = await prisma.commission.findUnique({ where: { sourceInvoiceId }, select: { id: true, status: true, amountCents: true, affiliateId: true } })
      if (row === null) {
        // Nothing accrued YET. Either this invoice never earned anything (unreferred customer, out
        // of window, zero rate) — in which case the tombstone is harmless — or the accrual is still
        // in flight behind a Stripe retry, in which case the tombstone is the whole point.
        // an empty id would match a tenant whose stripeCustomerId is '' — a guest charge must
        // resolve to nobody, not to whoever happens to have a blank column
        const tenant = stripeCustomerId === '' ? null : await prisma.tenant.findFirst({
          where: { stripeCustomerId },
          select: { id: true, referredByAffiliateId: true },
        })
        if (tenant === null || tenant.referredByAffiliateId === null) return 'none' // nobody could ever earn on it
        try {
          const stone = await prisma.commission.create({
            data: {
              affiliateId: tenant.referredByAffiliateId, tenantId: tenant.id, sourceInvoiceId,
              amountCents: 0, baseAmountCents: 0, status: 'void',
            },
          })
          await audit.recordPlatform(system, {
            action: 'create', entity: 'commission', entityId: stone.id,
            after: { status: 'void', amountCents: 0, affiliateId: stone.affiliateId, reason: 'refund_before_accrual', sourceInvoiceId },
          })
          return 'tombstoned'
        } catch (err) {
          // the accrual won the race between our read and this write — fall through and void it
          if (!isUniqueViolation(err)) throw err
          const late = await prisma.commission.findUnique({ where: { sourceInvoiceId }, select: { id: true, status: true, amountCents: true, affiliateId: true } })
          if (late === null || late.status === 'paid') return late === null ? 'none' : 'alreadyPaid'
          if (late.status !== 'void') await prisma.commission.update({ where: { id: late.id }, data: { status: 'void' } })
          return 'voided'
        }
      }
      if (row.status === 'paid') {
        // The one case nothing here can fix: the partner has the cash and the sale is reversed. The
        // portal promises we get in touch rather than reverse it quietly — a promise that needs a
        // durable record, not a line on stdout that scrolls away.
        await audit.recordPlatform(system, {
          action: 'update', entity: 'commission', entityId: row.id,
          before: { status: 'paid', amountCents: row.amountCents, affiliateId: row.affiliateId },
          after: { status: 'paid', amountCents: row.amountCents, affiliateId: row.affiliateId, reason: 'refund_after_payout_manual_clawback', sourceInvoiceId },
        })
        return 'alreadyPaid'
      }
      if (row.status === 'void') return 'voided' // idempotent: a redelivered refund event is a no-op
      await prisma.commission.update({ where: { id: row.id }, data: { status: 'void' } })
      // the same write setCommissionStatus audits, for the same reason: reversing an accrual is a
      // money decision, and after a payout dispute there must be something to point at
      await audit.recordPlatform(system, {
        action: 'update', entity: 'commission', entityId: row.id,
        before: { status: row.status, amountCents: row.amountCents, affiliateId: row.affiliateId },
        after: { status: 'void', amountCents: row.amountCents, affiliateId: row.affiliateId, reason: 'charge_refunded', sourceInvoiceId },
      })
      return 'voided'
    },
    setCommissionStatus: async (actor, id, status) => {
      const before = await prisma.commission.findUnique({ where: { id } })
      if (before === null) return null
      const after = await prisma.commission.update({ where: { id }, data: { status } })
      // marking an accrual paid/void IS the payout decision — it must be attributable
      await audit.recordPlatform(actor, {
        action: 'update',
        entity: 'commission',
        entityId: id,
        before: { status: before.status, amountCents: before.amountCents, affiliateId: before.affiliateId },
        after: { status: after.status, amountCents: after.amountCents, affiliateId: after.affiliateId },
      })
      return after
    },
    findByEmailForAuth: async (email) => {
      // case-insensitive by the functional unique index — rows created before the normalization
      // migration, and any future mixed-case input, both resolve here
      const rows = await prisma.$queryRaw<{ id: string; email: string; passwordHash: string | null; status: AffiliateStatus }[]>`
        SELECT "id", "email", "passwordHash", "status" FROM "affiliates"
        WHERE lower("email") = lower(${email}) LIMIT 1`
      return rows[0] ?? null
    },
    setPassword: async (id, passwordHash) => {
      await prisma.affiliate.update({ where: { id }, data: { passwordHash } })
    },
    createPwToken: async (affiliateId, tokenHash, expiresAt) => {
      await prisma.affiliatePasswordToken.create({ data: { affiliateId, tokenHash, expiresAt } })
    },
    replacePwToken: async (affiliateId, tokenHash, expiresAt, now) => {
      await prisma.$transaction([
        prisma.affiliatePasswordToken.updateMany({ where: { affiliateId, usedAt: null }, data: { usedAt: now } }),
        prisma.affiliatePasswordToken.create({ data: { affiliateId, tokenHash, expiresAt } }),
      ])
    },
    consumePwToken: async (tokenHash, now) => {
      // atomic single-use claim: only an unused, unexpired token matches (mirrors passwordResetTokens)
      const claimed = await prisma.affiliatePasswordToken.updateManyAndReturn({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
        select: { affiliateId: true },
      })
      return claimed[0]?.affiliateId ?? null
    },
    invalidatePwTokens: async (affiliateId, now) => {
      await prisma.affiliatePasswordToken.updateMany({ where: { affiliateId, usedAt: null }, data: { usedAt: now } })
    },
  }
  return repo
}
