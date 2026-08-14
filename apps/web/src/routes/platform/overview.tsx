import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Badge, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { consoleAlerts, consoleOverview } from '@/lib/console'

/**
 * The console's home: the business in one screen.
 *
 * What is deliberately NOT here is as important as what is. No trip list, no event feed, no map —
 * those are one customer's operations and they belong to that customer's dashboard. This page
 * answers the questions only the platform owner can ask: how many customers, how much revenue, who
 * is about to be cut off, and is anything on fire.
 */
const eur = (n: number) => `€${n.toLocaleString('lt-LT')}`

export function ConsoleOverviewPage() {
  const { t } = useTranslation()
  const overview = useQuery({ queryKey: ['console', 'overview'], queryFn: consoleOverview })
  const alerts = useQuery({ queryKey: ['console', 'alerts'], queryFn: consoleAlerts, refetchInterval: 60_000 })

  if (overview.isLoading) return <p className="admin-card p-4 text-sm" data-testid="console-overview-loading">…</p>
  if (overview.isError || overview.data === undefined) {
    return (
      <p role="alert" className="admin-card p-4 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="console-overview-error">
        {t('console.loadError')}
      </p>
    )
  }
  const o = overview.data
  const firing = alerts.data?.alerts ?? []
  const critical = firing.filter((a) => a.severity === 'critical')

  return (
    <div className="flex flex-col gap-6" data-testid="console-overview">
      <PageHeader title={t('console.overview.title')} description={t('console.overview.desc')} />

      {/* Anything on fire goes ABOVE the numbers. A dashboard that reports healthy revenue while a
          critical alert burns below the fold is how an outage stays unnoticed for eight days. */}
      {critical.length > 0 && (
        <div className="admin-card p-4" style={{ borderColor: 'var(--admin-danger)' }} role="alert" data-testid="console-overview-critical">
          <div className="mb-2 text-sm font-semibold" style={{ color: 'var(--admin-danger)' }}>
            {t('console.overview.criticalAlerts', { count: critical.length })}
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {critical.slice(0, 5).map((a) => (
              <li key={`${a.name}-${a.startsAt ?? ''}`} style={{ color: 'var(--admin-ink-soft)' }}>
                <span style={{ color: 'var(--admin-ink)' }}>{a.name}</span> — {a.summary ?? ''}
              </li>
            ))}
          </ul>
          <Link to="/platform/errors" className="mt-2 inline-block text-sm underline" style={{ color: 'var(--admin-ink-soft)' }}>
            {t('console.overview.seeAll')}
          </Link>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('console.overview.customers')} value={o.tenants.total} hint={t('console.overview.customersHint', { paying: o.tenants.paying, trialing: o.tenants.trialing })} data-testid="stat-tenants" />
        <StatCard
          label={t('console.overview.mrr')}
          value={eur(o.revenue.monthlyEurAtList)}
          hint={
            o.revenue.unpricedTenants > 0
              ? t('console.overview.mrrHintEnterprise', { count: o.revenue.unpricedTenants })
              : t('console.overview.mrrHint')
          }
          data-testid="stat-mrr"
        />
        <StatCard label={t('console.overview.devices')} value={o.devices.active} hint={t('console.overview.devicesHint', { retired: o.devices.retired })} data-testid="stat-devices" />
        <StatCard
          label={t('console.overview.lapsing')}
          value={o.tenants.lapsing + o.tenants.suspended}
          hint={t('console.overview.lapsingHint', { suspended: o.tenants.suspended })}
          data-testid="stat-lapsing"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('console.overview.users')} value={o.users.total} hint={t('console.overview.usersHint', { active: o.users.activeLast30d, never: o.users.neverLoggedIn })} data-testid="stat-users" />
        <StatCard label={t('console.overview.newTenants')} value={o.growth.tenantsLast30d} hint={t('console.overview.last30d')} data-testid="stat-growth" />
        <StatCard label={t('console.overview.partners')} value={o.partners.active} hint={t('console.overview.partnersHint', { referred: o.partners.referredTenants })} data-testid="stat-partners" />
        <StatCard label={t('console.overview.disabledUsers')} value={o.users.disabled} hint={t('console.overview.disabledHint')} data-testid="stat-disabled" />
      </section>

      <section className="admin-card p-4">
        <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('console.overview.byPlan')}
        </h2>
        <div className="flex flex-wrap gap-2" data-testid="console-overview-plans">
          {Object.entries(o.tenants.byPlan)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([plan, n]) => {
              const paying = o.tenants.payingByPlan[plan] ?? 0
              return (
                <Badge key={plan} tone={plan.startsWith('tsp_') ? 'info' : 'neutral'}>
                  {plan}: {n}
                  {paying > 0 ? ` (${t('console.overview.payingShort', { count: paying })})` : ''}
                </Badge>
              )
            })}
        </div>
      </section>
    </div>
  )
}
