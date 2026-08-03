import type { Affiliate, AffiliateStatus, Commission, CommissionStatus, PrismaClient } from '@prisma/client'

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
  list(): Promise<Affiliate[]>
  get(id: string): Promise<Affiliate | null>
  /** Attribution lookup for public signup: an ACTIVE affiliate by referral code, else null. */
  getActiveByCode(code: string): Promise<Affiliate | null>
  create(actor: Actor, data: AffiliateCreate): Promise<Affiliate>
  update(actor: Actor, id: string, data: AffiliateUpdate): Promise<Affiliate | null>
  /** Accrue a commission, idempotent on sourceInvoiceId (a webhook retry is a no-op → returns null). */
  accrueCommission(data: CommissionAccrual): Promise<Commission | null>
  /**
   * Webhook path (F4): a referred tenant paid an invoice → accrue the partner's commission. Returns
   * the Commission, or null when nothing is owed: no referral, the affiliate isn't active, the payment
   * falls OUTSIDE the commissionMonths window (measured from the tenant's createdAt), a non-positive
   * amount, or a duplicate invoice (idempotent). All lookups + window math live here (rule 2).
   */
  accrueForPaidInvoice(invoice: PaidInvoice): Promise<Commission | null>
  listCommissions(affiliateId?: string): Promise<Commission[]>
  setCommissionStatus(id: string, status: CommissionStatus): Promise<Commission | null>
}

export function createAffiliateRepo(prisma: PrismaClient): AffiliateRepo {
  return {
    list: () => prisma.affiliate.findMany({ orderBy: { createdAt: 'desc' } }),
    get: (id) => prisma.affiliate.findUnique({ where: { id } }),
    getActiveByCode: (code) => prisma.affiliate.findFirst({ where: { code, status: 'active' } }),
    create: async (_actor, data) => {
      try {
        return await prisma.affiliate.create({
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
      const before = await prisma.affiliate.findUnique({ where: { id } })
      if (before === null) return null
      return prisma.affiliate.update({ where: { id }, data })
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
        select: { id: true, referredByAffiliateId: true, createdAt: true },
      })
      if (tenant === null || tenant.referredByAffiliateId === null) return null // not a referred tenant
      const affiliate = await prisma.affiliate.findUnique({ where: { id: tenant.referredByAffiliateId } })
      if (affiliate === null || affiliate.status !== 'active') return null // suspended/pending ⇒ commissions stop
      // window: commissions accrue for commissionMonths from the tenant's signup (createdAt)
      if (invoice.paidAt > addMonthsUtc(tenant.createdAt, affiliate.commissionMonths)) return null
      const amountCents = Math.floor((invoice.amountPaidCents * Number(affiliate.commissionPct)) / 100)
      if (amountCents <= 0) return null // a $0 invoice / 100%-discount / zero-rate owes nothing
      // idempotent on the invoice id — a webhook retry is a no-op
      try {
        return await prisma.commission.create({
          data: { affiliateId: affiliate.id, tenantId: tenant.id, amountCents, currency: invoice.currency, sourceInvoiceId: invoice.invoiceId },
        })
      } catch {
        return null
      }
    },
    listCommissions: (affiliateId) =>
      prisma.commission.findMany({ where: affiliateId !== undefined ? { affiliateId } : {}, orderBy: { createdAt: 'desc' } }),
    setCommissionStatus: async (id, status) => {
      const before = await prisma.commission.findUnique({ where: { id } })
      if (before === null) return null
      return prisma.commission.update({ where: { id }, data: { status } })
    },
  }
}
