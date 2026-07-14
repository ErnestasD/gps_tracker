import type { BillingPlanView, BillingView } from '@orbetra/shared'

import { getJson, mutate } from './client'

/** Billing API client (Stripe, ADR-024). Checkout/portal return a hosted URL to redirect to. */
export const getBilling = () => getJson<BillingView>('/v1/billing')
export const listPlans = () => getJson<BillingPlanView[]>('/v1/billing/plans')
export const startCheckout = (priceId?: string) => mutate<{ url: string }>('POST', '/v1/billing/checkout', priceId ? { priceId } : undefined)
export const openPortal = () => mutate<{ url: string }>('POST', '/v1/billing/portal')

/** Format a plan's minor-unit amount (cents) + currency for display, e.g. 1500,'eur' → "€15". */
export function fmtPlanAmount(amount: number | null, currency: string): string {
  if (amount === null) return ''
  const symbol = currency.toLowerCase() === 'eur' ? '€' : `${currency.toUpperCase()} `
  const major = amount / 100
  return `${symbol}${Number.isInteger(major) ? major : major.toFixed(2)}`
}
