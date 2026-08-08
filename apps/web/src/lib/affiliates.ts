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
/** Money a partner has produced, per currency — never summed across them. */
export interface AffiliateMoney {
  currency: string
  earnedCents: number
  paidCents: number
  pendingCents: number
}

/** The registry row: the partner PLUS what they are worth. `/v1/affiliates` returns this shape. */
export interface AffiliateWithStats extends AffiliateView {
  stats: {
    customers: number
    notPaying: number
    earning: number
    money: AffiliateMoney[]
  }
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

export const listAffiliates = () => getJson<AffiliateWithStats[]>('/v1/affiliates')
export const createAffiliate = (data: AffiliateCreateInput) => mutate<AffiliateView>('POST', '/v1/affiliates', data)
export const updateAffiliate = (id: string, data: AffiliateUpdateInput) => mutate<AffiliateView>('PATCH', `/v1/affiliates/${enc(id)}`, data)
export const listCommissions = (affiliateId: string) => getJson<CommissionView[]>(`/v1/affiliates/${enc(affiliateId)}/commissions`)
export const setCommissionStatus = (id: string, status: CommissionStatus) => mutate<CommissionView>('PATCH', `/v1/commissions/${enc(id)}`, { status })

/**
 * Mint a one-time set/reset-password token for a partner and turn it into the link they click.
 *
 * The plaintext exists ONCE, in this response — only its hash is stored — so the admin must copy it
 * before closing the panel. Until this had a button, onboarding a partner meant an admin running
 * curl by hand, which is why the founder's first partner account was created from a terminal.
 */
export const issuePartnerLoginLink = async (id: string): Promise<string> => {
  const { token } = await mutate<{ token: string }>('POST', `/v1/affiliates/${enc(id)}/set-password-token`)
  const site = (import.meta.env['VITE_SITE_URL'] as string | undefined) ?? 'https://orbetra.com'
  return `${site}/partner/set-password?token=${enc(token)}`
}
