import type { BillingView } from '@orbetra/shared'

import { getJson, mutate } from './client'

/** Billing API client (Stripe, ADR-024). Checkout/portal return a hosted URL to redirect to. */
export const getBilling = () => getJson<BillingView>('/v1/billing')
export const startCheckout = () => mutate<{ url: string }>('POST', '/v1/billing/checkout')
export const openPortal = () => mutate<{ url: string }>('POST', '/v1/billing/portal')
