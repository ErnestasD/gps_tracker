import type { BillingDetailsView, BillingPlanView, BillingView, PlanChangePreviewView } from '@orbetra/shared'

import { getJson, mutate } from './client'

/** Billing API client (Stripe, ADR-024). Checkout/portal return a hosted URL to redirect to. */
export const getBilling = () => getJson<BillingView>('/v1/billing')
export const listPlans = () => getJson<BillingPlanView[]>('/v1/billing/plans')
/** Live Stripe details for the advanced billing page (period, upcoming invoice, card, overage rate). */
export const getBillingDetails = () => getJson<BillingDetailsView>('/v1/billing/details')
/** Prorated preview of a plan change — real credit/charge/net, computed by Stripe, nothing applied. */
export const getChangePreview = (priceId: string) => getJson<PlanChangePreviewView>(`/v1/billing/change-preview?priceId=${encodeURIComponent(priceId)}`)
export const startCheckout = (priceId?: string) => mutate<{ url: string }>('POST', '/v1/billing/checkout', priceId ? { priceId } : undefined)
export const openPortal = () => mutate<{ url: string }>('POST', '/v1/billing/portal')
/** Move an active subscription to another TSP plan (swaps base + overage, prorated). */
export const changePlan = (priceId: string) => mutate<{ ok: boolean }>('POST', '/v1/billing/change-plan', { priceId })

/** Format a plan's minor-unit amount (cents) + currency for display, e.g. 1500,'eur' → "€15". */
export function fmtPlanAmount(amount: number | null, currency: string): string {
  if (amount === null) return ''
  const symbol = currency.toLowerCase() === 'eur' ? '€' : `${currency.toUpperCase()} `
  const major = amount / 100
  return `${symbol}${Number.isInteger(major) ? major : major.toFixed(2)}`
}
