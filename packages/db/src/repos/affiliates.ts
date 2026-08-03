import type { Affiliate, AffiliateStatus, Commission, CommissionStatus, PrismaClient } from '@prisma/client'

import type { Actor } from '../scope.js'

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
    create: (_actor, data) =>
      prisma.affiliate.create({
        data: {
          name: data.name,
          email: data.email,
          code: data.code,
          ...(data.commissionPct !== undefined ? { commissionPct: data.commissionPct } : {}),
          ...(data.commissionMonths !== undefined ? { commissionMonths: data.commissionMonths } : {}),
        },
      }),
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
