import { isDirectPlan } from '@orbetra/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, PageHeader } from '@/components/admin/AdminKit'
import { getCurrentUser } from '@/lib/auth'
import { fmtPlanAmount, getBilling, listPlans, openPortal, startCheckout } from '@/lib/billing'
import { useFmt } from '@/lib/datetime'

/**
 * Billing (Stripe, ADR-024). Shows the subscription status and hands off to Stripe-hosted
 * Checkout (subscribe) / Customer Portal (manage) — we host no payment UI. Subscription state
 * is authoritative from the webhook; on return from Stripe we just refetch. When not subscribed,
 * a plan picker (resolved from the server's configured Stripe prices) drives checkout.
 * Re-skinned onto the admin design (ADR-028): PageHeader + admin-card sections.
 */
export function BillingPage() {
  const { t } = useTranslation()
  const { d } = useFmt()
  // WP3: a Direct-plan tenant has the TSP-plus nav (branding/api-keys/webhooks) hidden entirely —
  // this page is where the upgrade path stays discoverable, so surface a "what TSP unlocks" CTA.
  const user = getCurrentUser()
  const showUpgrade = user !== null && (isDirectPlan(user.plan) || !user.entitlements.whiteLabel)
  const upgradeFeatures = ['whiteLabel', 'customDomains', 'subAccounts', 'api', 'webhooks'] as const
  const billing = useQuery({ queryKey: ['billing'], queryFn: getBilling })
  const b = billing.data
  // a lapsed subscription (past_due/unpaid/canceled) is FIXED via the Stripe portal, not by
  // subscribing to a new plan — don't show the plan picker for those; send them to Manage instead
  // payment-repair statuses go to the portal (Fix payment); a terminally-canceled sub is NOT
  // recoverable via the portal — it must re-subscribe through the picker (matches the server's
  // RESUBSCRIBABLE allowlist, which permits checkout for 'canceled'). Review HIGH: dropping
  // 'canceled' here left a canceled tenant with no working re-subscribe path.
  // the picker only makes sense for statuses the server will actually checkout (RESUBSCRIBABLE =
  // canceled / incomplete_expired, plus no-subscription-at-all). Every other inactive status —
  // past_due, unpaid, incomplete, paused — is a LIVE sub the server 409s on checkout, so route it
  // to the portal (Fix payment) instead of showing dead Subscribe buttons.
  const recoverable = ['past_due', 'unpaid', 'incomplete', 'paused'].includes(b?.status ?? '')
  const showPicker = b?.configured === true && !b.active && !recoverable
  // only fetch the catalog when the picker is shown (each plan is a live Stripe price lookup);
  // catalog data is near-static, so cache it for the session
  const plans = useQuery({ queryKey: ['billing', 'plans'], queryFn: listPlans, enabled: showPicker, staleTime: 5 * 60 * 1000 })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(false) // Stripe handoff failed (was invisible)

  const go = (fn: () => Promise<{ url: string }>) => {
    setBusy(true)
    setActionError(false)
    fn()
      .then(({ url }) => { window.location.href = url }) // redirect to the Stripe-hosted page
      .catch(() => { setBusy(false); setActionError(true) }) // 500/429/misconfig — tell the user instead of nothing
  }

  // Stripe's machine status (mirrors subscription.status) → catalog label; the raw value is the
  // defaultValue fallback so an unmapped future status still renders instead of a literal key
  const statusLabel = b?.status != null ? t(`billing.st.${b.status}`, b.status) : t('billing.none')
  // the period-end date means different things per status: an active sub renews, a canceled one
  // ends, a past_due/unpaid one is overdue — don't label them all "Renews"
  const periodLabel =
    b?.status === 'past_due' || b?.status === 'unpaid'
      ? t('billing.pastDue')
      : b?.status === 'canceled'
        ? t('billing.ends')
        : t('billing.renews')

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('billing.title')} description={t('billing.desc')} />

      {showUpgrade && (
        <div className="admin-card overflow-hidden" data-testid="billing-upgrade">
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge tone="brand">{t('billing.upgrade.badge')}</Badge>
                <span className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('billing.upgrade.title')}</span>
              </div>
              <p className="max-w-xl text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.upgrade.desc')}</p>
              <ul className="grid grid-cols-1 gap-x-6 gap-y-1 pt-1 sm:grid-cols-2">
                {upgradeFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm" style={{ color: 'var(--admin-ink)' }}>
                    <span aria-hidden style={{ color: 'var(--admin-brand)' }}>✓</span>
                    <span>{t(`billing.upgrade.features.${f}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="shrink-0">
              <a href="mailto:sales@orbetra.com?subject=Orbetra%20White-label%2FTSP%20upgrade" data-testid="billing-upgrade-cta">
                <AdminButton variant="primary">{t('billing.upgrade.cta')}</AdminButton>
              </a>
              <p className="mt-2 max-w-[16rem] text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.upgrade.note')}</p>
            </div>
          </div>
        </div>
      )}

      {actionError && (
        <p role="alert" className="admin-card p-3 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="billing-action-error">
          {t('billing.actionError')}
        </p>
      )}

      {billing.isLoading ? (
        <p className="admin-card p-6 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="billing-loading">
          {t('admin.loading')}
        </p>
      ) : billing.isError ? (
        <p role="alert" className="admin-card p-6 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="billing-error">
          {t('billing.loadError')}
        </p>
      ) : b?.configured === false ? (
        <div className="admin-card p-6 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="billing-unconfigured">
          {t('billing.unavailable')}
        </div>
      ) : (
        <>
          <div className="admin-card">
            <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('billing.subscription')}</span>
              {b !== undefined && (
                <Badge tone={b.active ? 'success' : 'neutral'} data-testid="billing-status">{statusLabel}</Badge>
              )}
            </div>
            <div className="flex flex-col gap-4 p-4">
              <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.pricingNote')}</p>
              {b?.currentPeriodEnd != null && (
                <p className="text-sm" style={{ color: 'var(--admin-ink)' }} data-testid="billing-period">
                  {periodLabel}: {d(b.currentPeriodEnd)}
                </p>
              )}
              {b?.hasCustomer === true && (
                <div>
                  <AdminButton variant={b.active ? 'primary' : recoverable ? 'primary' : 'secondary'} disabled={busy} data-testid="billing-manage" onClick={() => go(openPortal)}>
                    {recoverable ? t('billing.fixPayment') : t('billing.manage')}
                  </AdminButton>
                </div>
              )}
            </div>
          </div>

          {showPicker && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="billing-plans">
              {(plans.data ?? []).map((p) => (
                <div key={p.priceId} className="admin-card flex flex-col gap-3 p-5" style={{ borderColor: 'var(--admin-brand)' }} data-testid={`plan-${p.priceId}`}>
                  <div className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{p.productName}</div>
                  <p className="display text-2xl font-semibold tracking-tight" style={{ color: 'var(--admin-ink)' }}>
                    {fmtPlanAmount(p.amount, p.currency)}
                    {/* no dangling "/ mo" on a metered (amount-less) price; raw interval is the
                        defaultValue fallback should Stripe send one outside the catalog */}
                    {p.amount !== null && p.interval !== null && (
                      <span className="text-sm font-normal" style={{ color: 'var(--admin-ink-soft)' }}> / {t(`billing.interval.${p.interval}`, p.interval)}</span>
                    )}
                  </p>
                  <div>
                    <AdminButton size="sm" disabled={busy} data-testid={`subscribe-${p.priceId}`} onClick={() => go(() => startCheckout(p.priceId))}>
                      {t('billing.subscribe')}
                    </AdminButton>
                  </div>
                </div>
              ))}
              {/* the catalog is a live Stripe lookup — don't flash the empty state while it loads */}
              {plans.isLoading ? (
                <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="plans-loading">{t('billing.loading')}</p>
              ) : plans.isError ? (
                /* a live Stripe lookup that fails is not "no plans configured" */
                <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="plans-error">{t('admin.loadError')}</p>
              ) : (
                (plans.data ?? []).length === 0 && (
                  <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="plans-empty">{t('billing.noPlans')}</p>
                )
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
