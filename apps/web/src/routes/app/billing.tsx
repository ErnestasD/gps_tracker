import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBilling, openPortal, startCheckout } from '@/lib/billing'

/**
 * Billing (Stripe, ADR-024). Shows the subscription status and hands off to Stripe-hosted
 * Checkout (subscribe) / Customer Portal (manage) — we host no payment UI. Subscription state
 * is authoritative from the webhook; on return from Stripe we just refetch.
 */
export function BillingPage() {
  const { t } = useTranslation()
  const billing = useQuery({ queryKey: ['billing'], queryFn: getBilling })
  const [busy, setBusy] = useState(false)

  const go = (fn: () => Promise<{ url: string }>) => {
    setBusy(true)
    fn()
      .then(({ url }) => { window.location.href = url }) // redirect to the Stripe-hosted page
      .catch(() => setBusy(false))
  }

  const b = billing.data
  const statusLabel = b?.status ?? t('billing.none')

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{t('billing.title')}</h1>

      {b?.configured === false ? (
        <Card><CardContent className="p-6 text-sm text-muted" data-testid="billing-unconfigured">{t('billing.unavailable')}</CardContent></Card>
      ) : (
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
            <div className="flex gap-2">
              {b?.hasCustomer && b.active ? (
                <Button disabled={busy} data-testid="billing-manage" onClick={() => go(openPortal)}>{t('billing.manage')}</Button>
              ) : (
                <Button disabled={busy} data-testid="billing-subscribe" onClick={() => go(startCheckout)}>{t('billing.subscribe')}</Button>
              )}
              {b?.hasCustomer && !b.active && (
                <Button variant="secondary" disabled={busy} data-testid="billing-manage" onClick={() => go(openPortal)}>{t('billing.manage')}</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
