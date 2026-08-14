import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { PLAN_MONTHLY_EUR, type TenantPlan } from '@orbetra/shared'

import { Badge, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { useFmt } from '@/lib/datetime'
import { consoleBilling, type ConsoleBillingRow } from '@/lib/console'

/**
 * Who pays, on what, and until when.
 *
 * The figures are LIST prices from the plan catalog, not invoices — an annual term, a negotiated
 * discount or a coupon all pay something else, and only Stripe knows what. The page says so rather
 * than presenting a derived number as billed revenue, because a founder steering on this must know
 * which of the two they are looking at.
 */
const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const td = 'px-4 py-2.5'

function statusTone(s: string | null, suspended: boolean): 'success' | 'warning' | 'danger' | 'neutral' {
  if (suspended) return 'danger'
  if (s === 'active') return 'success'
  if (s === 'trialing') return 'neutral'
  if (s === 'past_due' || s === 'unpaid') return 'warning'
  if (s === 'canceled') return 'danger'
  return 'neutral'
}

export function ConsoleBillingPage() {
  const { t } = useTranslation()
  const fmt = useFmt()
  const q = useQuery({ queryKey: ['console', 'billing'], queryFn: consoleBilling })
  const rows: ConsoleBillingRow[] = q.data ?? []

  const paying = rows.filter((r) => r.subscriptionStatus === 'active' || r.subscriptionStatus === 'past_due')
  const mrr = paying.reduce((sum, r) => sum + (PLAN_MONTHLY_EUR[r.plan as TenantPlan] ?? 0), 0)
  const custom = paying.filter((r) => PLAN_MONTHLY_EUR[r.plan as TenantPlan] === null).length

  return (
    <div className="flex flex-col gap-6" data-testid="console-billing">
      <PageHeader title={t('console.billing.title')} description={t('console.billing.desc')} />

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t('console.billing.mrr')} value={`€${mrr.toLocaleString('lt-LT')}`} hint={t('console.billing.mrrHint')} data-testid="billing-mrr" />
        <StatCard label={t('console.billing.paying')} value={paying.length} hint={t('console.billing.payingHint', { total: rows.length })} data-testid="billing-paying" />
        <StatCard label={t('console.billing.custom')} value={custom} hint={t('console.billing.customHint')} data-testid="billing-custom" />
      </section>

      {q.isError && (
        <p role="alert" className="admin-card p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>
          {t('console.loadError')}
        </p>
      )}

      <div className="admin-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="admin-hairline-b">
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.billing.tenant')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.billing.plan')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.billing.status')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.billing.listPrice')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.billing.periodEnd')}</th>
              <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.billing.devices')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const price = PLAN_MONTHLY_EUR[r.plan as TenantPlan]
              return (
                <tr key={r.tenantId} className="admin-hairline-b" data-testid={`billing-${r.tenantId}`}>
                  <td className={`${td} font-medium`} style={{ color: 'var(--admin-ink)' }}>{r.tenantName}</td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{r.plan}</td>
                  <td className={td}>
                    <Badge tone={statusTone(r.subscriptionStatus, r.suspendedAt !== null)}>
                      {r.suspendedAt !== null ? t('console.billing.suspended') : (r.subscriptionStatus ?? t('console.billing.noSubscription'))}
                    </Badge>
                  </td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>
                    {price === null ? t('console.billing.quoted') : `€${price}`}
                  </td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>
                    {r.currentPeriodEnd === null ? '—' : fmt.d(r.currentPeriodEnd)}
                  </td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{r.activeDevices}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
