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
  /** the partner's own language for the mail WE send them (en|lt|de|pl) */
  locale: string
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
  locale?: string
}

/** A partner's claim on a prospect, as the admin queue shows it. */
export interface DealView {
  id: string
  affiliateName: string
  affiliateId: string
  company: string
  domain: string
  contactName: string | null
  contactEmail: string | null
  note: string | null
  status: 'pending' | 'approved' | 'rejected' | 'converted'
  /** the claiming partner's OWN email domain — a match with `domain` is a self-referral signal */
  affiliateEmailDomain: string
  /**
   * What we already have at that domain. SHOWN, not enforced at approval: the test is a heuristic
   * over email domains and will be wrong sometimes, so an admin who can see a claim is legitimate
   * must be able to approve it anyway.
   */
  standing: { accounts: number; houseAccounts: number; otherPartnerAccounts: number }
  reason: string | null
  expiresAt: string | null
  convertedTenantId: string | null
  createdAt: string
}

const enc = encodeURIComponent

export const listAffiliates = () => getJson<AffiliateWithStats[]>('/v1/affiliates')
export const createAffiliate = (data: AffiliateCreateInput) => mutate<AffiliateView>('POST', '/v1/affiliates', data)
export const updateAffiliate = (id: string, data: AffiliateUpdateInput) => mutate<AffiliateView>('PATCH', `/v1/affiliates/${enc(id)}`, data)
export const listDeals = () => getJson<DealView[]>('/v1/deals')
/**
 * Approve or reject a claim.
 *
 * Approval is the whole anti-land-grab control: an approved claim attributes future signups on that
 * domain to this partner for 90 days, so it is a money decision and the server audits it. A 409
 * means another partner already holds a live claim on the same domain.
 */
export const decideDeal = (id: string, status: 'approved' | 'rejected', reason?: string) =>
  mutate<DealView>('PATCH', `/v1/deals/${enc(id)}`, { status, ...(reason !== undefined && reason !== '' ? { reason } : {}) })

export const listCommissions = (affiliateId: string) => getJson<CommissionView[]>(`/v1/affiliates/${enc(affiliateId)}/commissions`)
export const setCommissionStatus = (id: string, status: CommissionStatus) => mutate<CommissionView>('PATCH', `/v1/commissions/${enc(id)}`, { status })

/** What the edit panel's three inputs hold — strings, because that is what an <input> gives you. */
export interface AffiliateDraft {
  name: string
  pct: string
  months: string
  locale: string
}

/**
 * The patch to send for an edited partner: ONLY the fields that actually changed.
 *
 * Pure, exported and tested because both of its failure modes are silent money bugs, and neither is
 * visible in the rendered panel:
 *
 *  * diffing against the LIVE row instead of what the panel opened with reverts a concurrent edit —
 *    the refetch-on-focus updates the row under an open sheet, so an untouched 20% input against a
 *    freshly-refetched 30% row sends `commissionPct: 20` when the admin only fixed a typo in a name;
 *  * an empty patch is valid against the partial schema, so a no-op save still writes an audit row
 *    with identical before/after — noise in the one trail a disputed rate change is settled from.
 *
 * Returns null when there is nothing to send, so the caller can skip the request entirely.
 */
export function buildAffiliatePatch(baseline: AffiliateView, draft: AffiliateDraft): AffiliateUpdateInput | null {
  const data: AffiliateUpdateInput = {}
  const name = draft.name.trim()
  const pct = Number(draft.pct)
  const months = Number(draft.months)
  if (name !== baseline.name.trim()) data.name = name
  // NaN from a cleared or non-numeric field is not a change — it is an invalid draft, and sending
  // it would let the server 400 on a field the admin never meant to touch
  if (Number.isFinite(pct) && draft.pct.trim() !== '' && pct !== Number(baseline.commissionPct)) data.commissionPct = pct
  if (Number.isFinite(months) && draft.months.trim() !== '' && months !== baseline.commissionMonths) data.commissionMonths = months
  if (draft.locale !== baseline.locale) data.locale = draft.locale
  return Object.keys(data).length === 0 ? null : data
}

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
