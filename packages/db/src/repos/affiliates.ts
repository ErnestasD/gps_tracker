import type { Affiliate, AffiliateStatus, Commission, CommissionStatus, PrismaClient } from '@prisma/client'

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
}

/** A commission accrued from a referred tenant's payment (idempotent on the source Stripe invoice). */
export interface CommissionAccrual {
  affiliateId: string
  tenantId: string
  amountCents: number
  currency: string
  sourceInvoiceId: string
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

/**
 * Affiliate/partner program repo (W9) — PLATFORM level (only platform_admin reaches the management
 * routes), so like the tenants repo it takes an Actor for audit but NO tenant scope. `getByCode` is
 * the ONE method the (unauthenticated) public signup path uses, to attribute a new tenant to a
 * referral code — it returns only ACTIVE affiliates so a pending/suspended code never attributes.
 */
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
  listCommissions(affiliateId?: string): Promise<Commission[]>
  setCommissionStatus(actor: Actor, id: string, status: CommissionStatus): Promise<Commission | null>

  // ── partner self-service auth (F5) — UNSCOPED by design (a partner is not a tenant user) ──────────
  /** Login lookup by email (partner sign-in). Returns the hash + status so the caller can argon2-verify
   *  and refuse a non-active partner. Null when no such affiliate. */
  findByEmailForAuth(email: string): Promise<{ id: string; email: string; passwordHash: string | null; status: AffiliateStatus } | null>
  setPassword(id: string, passwordHash: string): Promise<void>
  /** Issue a one-time set/reset-password token (store only its hash). */
  createPwToken(affiliateId: string, tokenHash: string, expiresAt: Date): Promise<void>
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
  return {
    list: () => prisma.affiliate.findMany({ orderBy: { createdAt: 'desc' }, select: PUBLIC_SELECT }),
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
      //  * the anchor was the earliest COMMISSION ROW, so any first payment that accrued nothing —
      //    partner still `pending`/`suspended` at the time, a 100%-off coupon, a 0% rate, a $0
      //    proration — left no row, and the window silently restarted at whichever later payment
      //    first produced one. A partner suspended for six months and reinstated got a fresh full
      //    term on a customer they had already been paid out on.
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
      } else if (invoice.paidAt < anchorAt) {
        // An EARLIER payment delivered after a later one (webhook reordering, a replay, an ops
        // backfill). The anchor is the FIRST payment, so it may move back — never forward. The term
        // stays as first snapshotted: re-reading it here would put the live value back in the path.
        await prisma.tenant.updateMany({ where: { id: tenant.id, commissionAnchorAt: { gt: invoice.paidAt } }, data: { commissionAnchorAt: invoice.paidAt } })
        anchorAt = invoice.paidAt
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
    listCommissions: (affiliateId) =>
      prisma.commission.findMany({ where: affiliateId !== undefined ? { affiliateId } : {}, orderBy: { createdAt: 'desc' } }),
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
}
