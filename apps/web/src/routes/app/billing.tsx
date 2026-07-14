import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtPlanAmount, getBilling, listPlans, openPortal, startCheckout } from '@/lib/billing'

/**
 * Billing (Stripe, ADR-024). Shows the subscription status and hands off to Stripe-hosted
 * Checkout (subscribe) / Customer Portal (manage) — we host no payment UI. Subscription state
 * is authoritative from the webhook; on return from Stripe we just refetch. When not subscribed,
 * a plan picker (resolved from the server's configured Stripe prices) drives checkout.
 */
export function BillingPage() {
  const { t } = useTranslation()
  const billing = useQuery({ queryKey: ['billing'], queryFn: getBilling })
  const b = billing.data
  const showPicker = b?.configured === true && !b.active
  // only fetch the catalog when the picker is shown (each plan is a live Stripe price lookup);
  // catalog data is near-static, so cache it for the session
  const plans = useQuery({ queryKey: ['billing', 'plans'], queryFn: listPlans, enabled: showPicker, staleTime: 5 * 60 * 1000 })
  const [busy, setBusy] = useState(false)

  const go = (fn: () => Promise<{ url: string }>) => {
    setBusy(true)
    fn()
      .then(({ url }) => { window.location.href = url }) // redirect to the Stripe-hosted page
      .catch(() => setBusy(false))
  }

  const statusLabel = b?.status ?? t('billing.none')

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-auto p-4">
      <h1 className="text-lg font-semibold">{t('billing.title')}</h1>

      {b?.configured === false ? (
        <Card><CardContent className="p-6 text-sm text-muted" data-testid="billing-unconfigured">{t('billing.unavailable')}</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{t('billing.subscription')}</CardTitle>
              {b !== undefined && (
                <Badge variant={b.active ? 'default' : 'outline'} data-testid="billing-status">{statusLabel}</Badge>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted">{t('billing.pricingNote')}</p>
              {b?.currentPeriodEnd != null && (
                <p className="text-sm" data-testid="billing-period">{t('billing.renews')}: {new Date(b.currentPeriodEnd).toLocaleDateString()}</p>
              )}
              {b?.hasCustomer === true && (
                <div>
                  <Button variant={b.active ? 'default' : 'secondary'} disabled={busy} data-testid="billing-manage" onClick={() => go(openPortal)}>{t('billing.manage')}</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {showPicker && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="billing-plans">
              {(plans.data ?? []).map((p) => (
                <Card key={p.priceId} data-testid={`plan-${p.priceId}`}>
                  <CardHeader><CardTitle className="text-base">{p.productName}</CardTitle></CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-xl font-semibold">
                      {fmtPlanAmount(p.amount, p.currency)}
                      {p.interval !== null && <span className="text-sm font-normal text-muted"> / {t(`billing.interval.${p.interval}`)}</span>}
                    </p>
                    <Button size="sm" disabled={busy} data-testid={`subscribe-${p.priceId}`} onClick={() => go(() => startCheckout(p.priceId))}>{t('billing.subscribe')}</Button>
                  </CardContent>
                </Card>
              ))}
              {(plans.data ?? []).length === 0 && <p className="text-sm text-muted" data-testid="plans-empty">{t('billing.noPlans')}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
