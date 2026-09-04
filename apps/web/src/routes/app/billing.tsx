import { isDirectPlan, TSP_INCLUDED_DEVICES, type BillingPlanView, type TenantPlan } from '@orbetra/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, PageHeader } from '@/components/admin/AdminKit'
import { useConfirm } from '@/components/admin/ConfirmDialog'
import { getCurrentUser } from '@/lib/auth'
import { usePublicBranding } from '@/lib/publicBranding'
import { changePlan, fmtPlanAmount, getBilling, getBillingDetails, getChangePreview, listPlans, openPortal, startCheckout } from '@/lib/billing'
import { tenantUsage } from '@/lib/usage'
import { useFmt } from '@/lib/datetime'

/** Minor units (cents) → localized money with sign, e.g. -5000,'eur' → "−€50.00". */
function fmtMoney(cents: number, currency: string): string {
  const symbol = currency.toLowerCase() === 'eur' ? '€' : `${currency.toUpperCase()} `
  const abs = Math.abs(cents) / 100
  return `${cents < 0 ? '−' : ''}${symbol}${abs.toFixed(2)}`
}

/**
 * Billing (Stripe, ADR-024). Shows the subscription status and hands off to Stripe-hosted
 * Checkout (subscribe) / Customer Portal (manage) — we host no payment UI. Subscription state
 * is authoritative from the webhook; on return from Stripe we just refetch. When not subscribed,
 * a plan picker (resolved from the server's configured Stripe prices) drives checkout; an active
 * TSP subscriber gets an in-app plan CHANGE (the portal can't swap our paired metered overage).
 * Re-skinned onto the admin design (ADR-028): PageHeader + admin-card sections.
 */

type Interval = 'month' | 'year'

/** Number of included devices for a plan, formatted, or null when not a metered-allowance plan. */
function includedDevices(plan: TenantPlan | null): number | null {
  if (plan === null) return null
  const n = TSP_INCLUDED_DEVICES[plan]
  return n ?? null
}

/**
 * One plan card — the same professional shape for the subscribe picker and the change-plan grid,
 * so a Direct user and a TSP reseller see the identical (non-cheap) layout the founder asked for.
 */
function PlanCard(props: {
  name: string
  amount: number | null
  currency: string
  intervalLabel: string | null
  includedLabel: string | null
  badge?: { label: string; tone: 'brand' | 'success' | 'neutral' | 'info' }
  highlight?: boolean
  ctaLabel: string
  ctaDisabled: boolean
  onCta: () => void
  testId: string
  ctaTestId: string
}) {
  return (
    <div
      className="admin-card flex flex-col gap-4 p-5"
      style={props.highlight ? { borderColor: 'var(--admin-brand)', boxShadow: 'var(--admin-shadow-sm)' } : undefined}
      data-testid={props.testId}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold" style={{ color: 'var(--admin-ink)' }}>{props.name}</h3>
        {props.badge && <Badge tone={props.badge.tone} className="shrink-0">{props.badge.label}</Badge>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="display text-3xl font-semibold tracking-tight" style={{ color: 'var(--admin-ink)' }}>
          {fmtPlanAmount(props.amount, props.currency)}
        </span>
        {props.amount !== null && props.intervalLabel && (
          <span className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>/ {props.intervalLabel}</span>
        )}
      </div>
      {props.includedLabel && (
        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{props.includedLabel}</p>
      )}
      <div className="mt-auto">
        <AdminButton
          variant={props.highlight ? 'primary' : 'secondary'}
          className="w-full"
          disabled={props.ctaDisabled}
          data-testid={props.ctaTestId}
          onClick={props.onCta}
        >
          {props.ctaLabel}
        </AdminButton>
      </div>
    </div>
  )
}

export function BillingPage() {
  const { t } = useTranslation()
  const { d } = useFmt()
  // WP3: a Direct-plan tenant has the TSP-plus nav (branding/api-keys/webhooks) hidden entirely —
  // this page is where the upgrade path stays discoverable, so surface a "what TSP unlocks" CTA.
  const user = getCurrentUser()
  // …and NEVER on a white-label host. The gate was plan-only, but a tenant that lapsed or was
  // downgraded keeps serving its verified custom domain (entitlements gate writes, not resolution),
  // so their own admins were shown our sales address and "run Orbetra under your own brand" on a
  // page inside their own product.
  // `!== true`, not `=== false`: an UNRESOLVED host (in flight, or a failed /v1/branding) must not
  // hide our own upgrade path forever — this is a revenue screen, and the white-label risk it guards
  // against only exists when the host IS a tenant's.
  const host = usePublicBranding()
  const showUpgrade = user !== null && host?.whiteLabel !== true && (isDirectPlan(user.plan) || !user.entitlements.whiteLabel)
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
  // the SERVER decides eligibility (`canSubscribe`, same predicate the checkout route enforces) so the
  // picker can never disagree with the API. This is what lets an F2 self-serve trial — which reports
  // active:true because status is `trialing` — still see plans and convert to paid.
  const showPicker = b?.configured === true && b.canSubscribe === true && !recoverable

  /**
   * Plan CHANGE (Start ⇄ Grow ⇄ Scale) for an active TSP subscriber — the Stripe Customer Portal
   * cannot do it for us (our subscriptions carry a paired metered overage item its switcher ignores;
   * see the server route). Only when actively subscribed AND on a TSP plan; a Direct tenant upgrades
   * via the sales CTA above, and a lapsed one repairs payment in the portal.
   */
  const canChangePlan = b?.active === true && b.planPriceId !== null && !showPicker && user !== null && !isDirectPlan(user.plan)

  // ONE catalog query drives both the subscribe picker and the change grid (same cache key).
  const catalog = useQuery({ queryKey: ['billing', 'plans'], queryFn: listPlans, enabled: showPicker || canChangePlan, staleTime: 5 * 60 * 1000 })
  const plans = useMemo(() => catalog.data ?? [], [catalog.data])

  // Live Stripe details (period, upcoming invoice, card, overage rate) for the advanced panels —
  // only when there IS an active subscription to describe.
  const details = useQuery({ queryKey: ['billing', 'details'], queryFn: getBillingDetails, enabled: b?.active === true, staleTime: 60 * 1000 })
  const periodStart = details.data?.periodStart ?? null
  // this-period device-day usage, bounded to the current billing period (once we know when it began).
  const usage = useQuery({
    queryKey: ['billing', 'usage', periodStart],
    queryFn: () => tenantUsage(periodStart!.slice(0, 10)),
    enabled: b?.active === true && periodStart !== null,
    staleTime: 60 * 1000,
  })

  const qc = useQueryClient()
  const { confirm, element: confirmElement } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(false) // Stripe handoff failed (was invisible)
  const [changingTo, setChangingTo] = useState<string | null>(null) // price id mid-change

  // which billing interval the grids show. Default to the interval the tenant is ALREADY on (so a
  // monthly subscriber sees monthly targets), else monthly.
  const currentPrice = plans.find((p) => p.priceId === b?.planPriceId)
  const [termSel, setTermSel] = useState<Interval | null>(null)
  const selInterval: Interval = termSel ?? (currentPrice?.interval === 'year' ? 'year' : 'month')
  // only offer the monthly/annual toggle when BOTH terms actually exist in the catalog
  const hasBothIntervals = plans.some((p) => p.interval === 'month') && plans.some((p) => p.interval === 'year')

  const includedLabelFor = (plan: TenantPlan | null): string | null => {
    const n = includedDevices(plan)
    return n !== null ? t('billing.includedDevices', { n }) : null
  }
  const intervalLabel = (iv: string | null): string | null => (iv !== null ? t(`billing.interval.${iv}`, iv) : null)

  /**
   * Confirm THEN switch. A plan change moves money — an accidental click must not silently re-bill a
   * reseller — so it goes through a modal that names the target plan, its price, and (verified against
   * Stripe) what actually happens to the money: with proration_behavior 'create_prorations' NOTHING is
   * charged now; the prorated difference (an upgrade's extra, a downgrade's credit) lands on the next
   * invoice at renewal.
   */
  const askAndChange = async (p: BillingPlanView & { plan: TenantPlan }, isUpgrade: boolean) => {
    const priceStr = `${fmtPlanAmount(p.amount, p.currency)}${p.interval !== null ? ` / ${intervalLabel(p.interval) ?? p.interval}` : ''}`
    // fetch the REAL prorated impact from Stripe before asking — spinner on the button meanwhile. A
    // preview that can't be computed falls back to the plain (still accurate) copy rather than blocking.
    setChangingTo(p.priceId)
    let preview: Awaited<ReturnType<typeof getChangePreview>> | null = null
    try {
      preview = await getChangePreview(p.priceId)
    } catch {
      preview = null
    }
    setChangingTo(null)

    let description: string
    if (preview !== null && preview.nextInvoiceDate !== null) {
      const date = d(preview.nextInvoiceDate)
      description =
        preview.net < 0
          ? t('billing.confirmCreditDetail', { plan: p.productName, price: priceStr, amount: fmtMoney(Math.abs(preview.net), preview.currency), date })
          : t('billing.confirmChargeDetail', { plan: p.productName, price: priceStr, net: fmtMoney(preview.net, preview.currency), date })
    } else {
      description = t(isUpgrade ? 'billing.confirmChangeUp' : 'billing.confirmChangeDown', { plan: p.productName, price: priceStr })
    }

    const ok = await confirm({
      title: t('billing.confirmChangeTitle', { plan: p.productName }),
      description,
      confirmLabel: t('billing.switchTo'),
      confirmTestId: `confirm-switch-${p.priceId}`,
    })
    if (!ok) return
    doChange(p.priceId)
  }

  const doChange = (priceId: string) => {
    setChangingTo(priceId)
    setActionError(false)
    changePlan(priceId)
      .then(() => {
        // The change is DONE the moment changePlan resolves (200). Refreshing billing afterwards is
        // best-effort and MUST NOT feed the error branch: invalidateQueries() rejects if any active
        // refetch fails, and chaining it into .then made a fully-successful switch report
        // "couldn't reach Stripe". So fire-and-forget (void), never return its promise here.
        // The webhook persists the new plan a beat after Stripe returns, so refetch once now and once
        // shortly after, so the grid + status reflect the new tier without a manual reload.
        void qc.invalidateQueries({ queryKey: ['billing'] })
        window.setTimeout(() => { void qc.invalidateQueries({ queryKey: ['billing'] }) }, 2500)
      })
      .catch(() => setActionError(true)) // only a real change-plan failure (non-2xx) shows the error
      .finally(() => setChangingTo(null))
  }

  const go = (fn: () => Promise<{ url: string }>) => {
    setBusy(true)
    setActionError(false)
    fn()
      .then(({ url }) => { window.location.href = url }) // redirect to the Stripe-hosted page
      .catch(() => { setBusy(false); setActionError(true) }) // 500/429/misconfig — tell the user instead of nothing
  }

  // the OTHER TSP tiers, at the selected interval — grouped by plan KEY (not a fragile name parse),
  // current tier excluded. This is what removes the "two TSP Grow cards / €1490 per month" confusion.
  const changeTargets = plans
    .filter((p): p is BillingPlanView & { plan: TenantPlan } =>
      p.plan !== null && !isDirectPlan(p.plan) && p.plan !== user?.plan && p.interval === selInterval && p.amount !== null)
    .sort((a, b2) => (a.amount ?? 0) - (b2.amount ?? 0))

  // subscribe picker: one card per plan at the selected interval (no monthly+annual duplicates).
  const pickerPlans = plans
    .filter((p) => p.interval === selInterval && p.amount !== null)
    .sort((a, b2) => (a.amount ?? 0) - (b2.amount ?? 0))

  const currentIncluded = includedDevices(user?.plan ?? null)

  // Usage this period. usage_daily has one row per device per UTC day it reported, so a day's
  // deviceDays IS that day's active-device count. Overage = the device-days beyond the allowance,
  // summed over the period — exactly what the worker bills to the metered price (per device-day).
  const usageRows = [...(usage.data ?? [])].sort((r1, r2) => r1.day.localeCompare(r2.day))
  const deviceDaysTotal = usageRows.reduce((s, r) => s + r.deviceDays, 0)
  const currentActive = usageRows.length > 0 ? usageRows[usageRows.length - 1]!.deviceDays : 0
  const peakActive = usageRows.reduce((m, r) => Math.max(m, r.deviceDays), 0)
  const overageDeviceDays = currentIncluded !== null ? usageRows.reduce((s, r) => s + Math.max(0, r.deviceDays - currentIncluded), 0) : 0
  const overageRate = details.data?.overagePerDeviceDay ?? null // cents / device-day
  const overageCurrency = details.data?.currency ?? 'eur'
  const projectedOverage = overageRate !== null ? Math.round(overageDeviceDays * overageRate) : null
  const usagePct = currentIncluded !== null && currentIncluded > 0 ? Math.min(100, Math.round((currentActive / currentIncluded) * 100)) : 0

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

  const IntervalToggle = hasBothIntervals ? (
    <div className="inline-flex rounded-md p-0.5" style={{ background: 'var(--admin-surface-2, var(--admin-surface))', border: '1px solid var(--admin-hairline)' }} data-testid="billing-interval-toggle">
      {(['month', 'year'] as const).map((iv) => (
        <button
          key={iv}
          type="button"
          onClick={() => setTermSel(iv)}
          data-testid={`interval-${iv}`}
          className="rounded px-3 py-1 text-xs font-medium transition-colors"
          style={selInterval === iv
            ? { background: 'var(--admin-brand)', color: '#fff' }
            : { background: 'transparent', color: 'var(--admin-ink-soft)' }}
        >
          {t(`billing.intervalToggle.${iv}`)}
        </button>
      ))}
    </div>
  ) : null

  return (
    <div className="w-full space-y-4 p-4 md:p-6">
      {confirmElement}
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

      {/*
        SUSPENDED (audit MED #22). This is the one banner in the product that explains why the live
        map is empty — "no devices are reporting" and "we stopped accepting their data" look
        identical on screen and could not be more different to the person reading it. It says what
        survived (everything) and how to undo it, because a customer who thinks their history is gone
        does not renew, they leave.
      */}
      {b?.suspendedAt != null && (
        <div role="alert" className="admin-card p-4 text-sm" style={{ borderColor: 'var(--admin-danger)', color: 'var(--admin-ink)' }} data-testid="billing-suspended">
          <p className="font-semibold" style={{ color: 'var(--admin-danger)' }}>{t('billing.suspendedTitle')}</p>
          <p className="mt-1 text-muted">{t('billing.suspendedBody')}</p>
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
              {/* the concrete current plan — a reseller steering their bill wants "which plan am I on"
                  answered in one line, not inferred from the grid below */}
              {canChangePlan && user !== null && (
                <p className="text-sm" style={{ color: 'var(--admin-ink)' }} data-testid="billing-current-plan">
                  {t('billing.currentPlan')}: <span className="font-semibold">{t(`plan.${user.plan}`, user.plan)}</span>
                  {currentIncluded !== null && (
                    <span style={{ color: 'var(--admin-ink-soft)' }}> · {t('billing.includedDevices', { n: currentIncluded })}</span>
                  )}
                </p>
              )}
              <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.pricingNote')}</p>
              {b?.currentPeriodEnd != null && (
                <p className="text-sm" style={{ color: 'var(--admin-ink)' }} data-testid="billing-period">
                  {periodLabel}: {d(b.currentPeriodEnd)}
                </p>
              )}
              {details.data?.paymentMethod != null && (
                <p className="text-sm capitalize" style={{ color: 'var(--admin-ink)' }} data-testid="billing-payment-method">
                  <span style={{ color: 'var(--admin-ink-soft)' }} className="normal-case">{t('billing.paymentMethod')}: </span>
                  {details.data.paymentMethod.brand} ···· {details.data.paymentMethod.last4}
                  <span className="normal-case" style={{ color: 'var(--admin-ink-soft)' }}> · {t('billing.expires')} {String(details.data.paymentMethod.expMonth).padStart(2, '0')}/{details.data.paymentMethod.expYear}</span>
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

          {/* Advanced panels: usage against the allowance, and what the next invoice will look like.
              Shown only for an active subscriber on a metered (TSP) allowance plan. */}
          {b?.active === true && currentIncluded !== null && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="admin-card" data-testid="billing-usage">
                <div className="admin-hairline-b px-4 py-3">
                  <span className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('billing.usageTitle')}</span>
                </div>
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="display text-2xl font-semibold tracking-tight" style={{ color: 'var(--admin-ink)' }}>
                      {currentActive} <span className="text-sm font-normal" style={{ color: 'var(--admin-ink-soft)' }}>/ {currentIncluded}</span>
                    </span>
                    <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.activeDevices')}</span>
                  </div>
                  {/* allowance meter */}
                  <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--admin-hairline)' }}>
                    <div className="h-full rounded-full" style={{ width: `${usagePct}%`, background: overageDeviceDays > 0 ? 'var(--admin-danger)' : 'var(--admin-brand)' }} />
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.peakDevices')}</dt>
                    <dd className="text-right" style={{ color: 'var(--admin-ink)' }}>{peakActive}</dd>
                    <dt style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.deviceDays')}</dt>
                    <dd className="text-right" style={{ color: 'var(--admin-ink)' }}>{deviceDaysTotal}</dd>
                    {overageDeviceDays > 0 && (
                      <>
                        <dt style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.overageDeviceDays')}</dt>
                        <dd className="text-right font-medium" style={{ color: 'var(--admin-danger)' }}>
                          {overageDeviceDays}{projectedOverage !== null && <> · ≈ {fmtMoney(projectedOverage, overageCurrency)}</>}
                        </dd>
                      </>
                    )}
                  </dl>
                  <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                    {overageDeviceDays > 0 ? t('billing.overageNote') : t('billing.withinAllowance')}
                  </p>
                </div>
              </div>

              <div className="admin-card" data-testid="billing-next-invoice">
                <div className="admin-hairline-b px-4 py-3">
                  <span className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('billing.nextInvoiceTitle')}</span>
                </div>
                <div className="flex flex-col gap-2 p-4">
                  {details.isLoading ? (
                    <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('admin.loading')}</p>
                  ) : details.data?.upcomingTotal != null ? (
                    <>
                      <span className="display text-2xl font-semibold tracking-tight" style={{ color: 'var(--admin-ink)' }} data-testid="next-invoice-amount">
                        {fmtMoney(details.data.upcomingTotal, details.data.currency ?? 'eur')}
                      </span>
                      {details.data.periodEnd != null && (
                        <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.on')} {d(details.data.periodEnd)}</p>
                      )}
                      <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.nextInvoiceNote')}</p>
                    </>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.noUpcoming')}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {canChangePlan && (
            <div className="space-y-3" data-testid="billing-change-plan">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('billing.changePlanTitle')}</h2>
                  <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('billing.changePlanNote')}</p>
                </div>
                {IntervalToggle}
              </div>
              {catalog.isLoading ? (
                <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="change-plan-loading">{t('billing.loading')}</p>
              ) : changeTargets.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="change-plan-empty">{t('billing.noOtherPlans')}</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {changeTargets.map((p) => {
                    const targetIncluded = includedDevices(p.plan)
                    const isUpgrade = currentIncluded !== null && targetIncluded !== null && targetIncluded > currentIncluded
                    return (
                      <PlanCard
                        key={p.priceId}
                        testId={`change-plan-${p.priceId}`}
                        ctaTestId={`switch-${p.priceId}`}
                        name={p.productName}
                        amount={p.amount}
                        currency={p.currency}
                        intervalLabel={intervalLabel(p.interval)}
                        includedLabel={includedLabelFor(p.plan)}
                        badge={currentIncluded !== null && targetIncluded !== null
                          ? (isUpgrade ? { label: t('billing.upgradeChip'), tone: 'brand' } : { label: t('billing.downgradeChip'), tone: 'neutral' })
                          : undefined}
                        highlight={isUpgrade}
                        ctaDisabled={changingTo !== null}
                        ctaLabel={changingTo === p.priceId ? t('billing.switching') : t('billing.switchTo')}
                        onCta={() => void askAndChange(p, isUpgrade)}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {showPicker && (
            <div className="space-y-3" data-testid="billing-plans">
              {hasBothIntervals && <div className="flex justify-end">{IntervalToggle}</div>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pickerPlans.map((p) => (
                  <PlanCard
                    key={p.priceId}
                    testId={`plan-${p.priceId}`}
                    ctaTestId={`subscribe-${p.priceId}`}
                    name={p.productName}
                    amount={p.amount}
                    currency={p.currency}
                    intervalLabel={intervalLabel(p.interval)}
                    includedLabel={includedLabelFor(p.plan)}
                    highlight
                    ctaDisabled={busy}
                    ctaLabel={t('billing.subscribe')}
                    onCta={() => go(() => startCheckout(p.priceId))}
                  />
                ))}
              </div>
              {/* the catalog is a live Stripe lookup — don't flash the empty state while it loads */}
              {catalog.isLoading ? (
                <p className="text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="plans-loading">{t('billing.loading')}</p>
              ) : catalog.isError ? (
                /* a live Stripe lookup that fails is not "no plans configured" */
                <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="plans-error">{t('admin.loadError')}</p>
              ) : (
                pickerPlans.length === 0 && (
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
