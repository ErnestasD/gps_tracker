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
  setCommissionStatus(id: string, status: CommissionStatus): Promise<Commission | null>

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

export function createAffiliateRepo(prisma: PrismaClient): AffiliateRepo {
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
    create: async (_actor, data) => {
      try {
        return await prisma.affiliate.create({
          select: PUBLIC_SELECT,
          data: {
            name: data.name,
            email: data.email,
            code: data.code,
            ...(data.commissionPct !== undefined ? { commissionPct: data.commissionPct } : {}),
            ...(data.commissionMonths !== undefined ? { commissionMonths: data.commissionMonths } : {}),
          },
        })
      } catch (err) {
        if (isUniqueViolation(err)) throw new AffiliateConflictError(conflictField(err))
        throw err // a real DB fault must reach the API's 500 net, NOT masquerade as a conflict
      }
    },
    update: async (_actor, id, data) => {
      const before = await prisma.affiliate.findUnique({ where: { id }, select: { id: true } })
      if (before === null) return null
      return prisma.affiliate.update({ where: { id }, data, select: PUBLIC_SELECT })
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
        select: { id: true, referredByAffiliateId: true },
      })
      if (tenant === null || tenant.referredByAffiliateId === null) return null // not a referred tenant
      const affiliate = await prisma.affiliate.findUnique({ where: { id: tenant.referredByAffiliateId } })
      if (affiliate === null || affiliate.status !== 'active') return null // suspended/pending ⇒ commissions stop
      // Window: commissionMonths from the tenant's FIRST PAYMENT (schema §commissionMonths — a trial
      // must not eat the window). The anchor is the earliest recorded `paidAt` (Stripe's clock), NOT a
      // row's DB insert time: createdAt drifts later with webhook lag/retries, silently EXTENDING the
      // earning window and over-paying (audit MED). Rows written before paidAt existed fall back to
      // createdAt so historical anchors stay stable.
      const first = await prisma.commission.findFirst({
        where: { affiliateId: affiliate.id, tenantId: tenant.id },
        orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
        select: { paidAt: true, createdAt: true },
      })
      const anchor = first?.paidAt ?? first?.createdAt ?? invoice.paidAt
      if (invoice.paidAt > addMonthsUtc(anchor, affiliate.commissionMonths)) return null
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
    setCommissionStatus: async (id, status) => {
      const before = await prisma.commission.findUnique({ where: { id } })
      if (before === null) return null
      return prisma.commission.update({ where: { id }, data: { status } })
    },
    findByEmailForAuth: (email) =>
      prisma.affiliate.findUnique({ where: { email }, select: { id: true, email: true, passwordHash: true, status: true } }),
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
