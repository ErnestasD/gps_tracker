import { getJson, mutate } from './client'

/**
 * Affiliate/partner management client (item 5 / W9). Platform_admin only on the server. Invite-only:
 * an admin creates a partner (a referral `code` is auto-generated when left blank) then flips its
 * status → active so the code starts attributing new tenants and accruing commissions.
 */
export type AffiliateStatus = 'pending' | 'active' | 'suspended'
export type CommissionStatus = 'pending' | 'paid' | 'void'

export interface AffiliateView {
  id: string
  name: string
  email: string
  code: string
  commissionPct: string // Decimal serialized as string
  commissionMonths: number
  status: AffiliateStatus
  createdAt: string
}
export interface CommissionView {
  id: string
  affiliateId: string
  tenantId: string
  amountCents: number
  currency: string
  sourceInvoiceId: string
  status: CommissionStatus
  createdAt: string
}
export interface AffiliateCreateInput {
  name: string
  email: string
  code?: string
  commissionPct?: number
  commissionMonths?: number
}
export interface AffiliateUpdateInput {
  name?: string
  status?: AffiliateStatus
  commissionPct?: number
  commissionMonths?: number
}

const enc = encodeURIComponent

export const listAffiliates = () => getJson<AffiliateView[]>('/v1/affiliates')
export const createAffiliate = (data: AffiliateCreateInput) => mutate<AffiliateView>('POST', '/v1/affiliates', data)
export const updateAffiliate = (id: string, data: AffiliateUpdateInput) => mutate<AffiliateView>('PATCH', `/v1/affiliates/${enc(id)}`, data)
export const listCommissions = (affiliateId: string) => getJson<CommissionView[]>(`/v1/affiliates/${enc(affiliateId)}/commissions`)
export const setCommissionStatus = (id: string, status: CommissionStatus) => mutate<CommissionView>('PATCH', `/v1/commissions/${enc(id)}`, { status })
