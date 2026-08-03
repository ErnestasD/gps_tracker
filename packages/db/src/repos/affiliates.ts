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
    listCommissions: (affiliateId) =>
      prisma.commission.findMany({ where: affiliateId !== undefined ? { affiliateId } : {}, orderBy: { createdAt: 'desc' } }),
    setCommissionStatus: async (id, status) => {
      const before = await prisma.commission.findUnique({ where: { id } })
      if (before === null) return null
      return prisma.commission.update({ where: { id }, data: { status } })
    },
  }
}
