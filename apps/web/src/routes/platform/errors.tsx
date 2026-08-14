import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, EmptyState, PageHeader } from '@/components/admin/AdminKit'
import { useFmt } from '@/lib/datetime'
import { consoleAlerts, consoleErrors, type ConsoleFailure } from '@/lib/console'

/**
 * What is broken — for a customer, or for the platform.
 *
 * TWO feeds on one page on purpose. "A tenant's webhooks are all failing" and "the database is
 * about to stop accepting writes" are both things the platform owner must see, they arrive from
 * completely different places, and having to remember to check two screens is how one of them goes
 * unnoticed. The infrastructure half comes from Alertmanager; the product half from our own
 * delivery tables.
 *
 * Product failures are GROUPED BY TENANT, never listed per event: two hundred identical failures
 * from one broken endpoint are one problem belonging to one customer, and rendering them as two
 * hundred rows buries the second customer whose integration also broke.
 */
const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const td = 'px-4 py-2.5'
const WINDOWS = [24, 72, 168] as const

export function ConsoleErrorsPage() {
  const { t } = useTranslation()
  const fmt = useFmt()
  const [hours, setHours] = useState<number>(24)

  const failures = useQuery({ queryKey: ['console', 'errors', hours], queryFn: () => consoleErrors(hours) })
  const alerts = useQuery({ queryKey: ['console', 'alerts'], queryFn: consoleAlerts, refetchInterval: 60_000 })

  const rows: ConsoleFailure[] = failures.data ?? []
  const firing = alerts.data?.alerts ?? []

  return (
    <div className="flex flex-col gap-6" data-testid="console-errors">
      <PageHeader title={t('console.errors.title')} description={t('console.errors.desc')} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
          {t('console.errors.infra')}
        </h2>
        {alerts.data?.configured === false ? (
          <p className="admin-card p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="console-alerts-unconfigured">
            {t('console.errors.alertsUnconfigured')}
          </p>
        ) : firing.length === 0 ? (
          <p className="admin-card p-4 text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="console-alerts-quiet">
            {t('console.errors.noAlerts')}
          </p>
        ) : (
          <div className="admin-card overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {firing.map((a) => (
                  <tr key={`${a.name}-${a.startsAt ?? ''}`} className="admin-hairline-b" data-testid={`console-alert-${a.name}`}>
                    <td className={td}>
                      <Badge tone={a.severity === 'critical' ? 'danger' : 'warning'}>{a.severity}</Badge>
                    </td>
                    <td className={`${td} font-medium`} style={{ color: 'var(--admin-ink)' }}>{a.name}</td>
                    <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{a.summary ?? a.description ?? ''}</td>
                    <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{a.startsAt === null ? '' : fmt.dt(a.startsAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
            {t('console.errors.product')}
          </h2>
          <div className="flex gap-1" role="group" aria-label={t('console.errors.window')}>
            {WINDOWS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className="rounded-md px-2.5 py-1 text-xs"
                style={{
                  background: hours === h ? 'var(--admin-surface-2)' : 'transparent',
                  color: hours === h ? 'var(--admin-ink)' : 'var(--admin-ink-soft)',
                }}
                data-testid={`console-errors-window-${h}`}
              >
                {t('console.errors.hours', { count: h })}
              </button>
            ))}
          </div>
        </div>

        {failures.isError && (
          <p role="alert" className="admin-card p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>
            {t('console.loadError')}
          </p>
        )}

        {!failures.isLoading && rows.length === 0 ? (
          <EmptyState title={t('console.errors.emptyTitle')} description={t('console.errors.emptyDesc')} data-testid="console-errors-empty" />
        ) : (
          <div className="admin-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="admin-hairline-b">
                  <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.errors.kind')}</th>
                  <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.errors.tenant')}</th>
                  <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.errors.count')}</th>
                  <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.errors.last')}</th>
                  <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.errors.detail')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.tenantId}`} className="admin-hairline-b" data-testid={`console-failure-${r.kind}-${r.tenantId}`}>
                    <td className={td}>
                      <Badge tone="warning">{t(`console.errors.kind_${r.kind}`)}</Badge>
                    </td>
                    <td className={`${td} font-medium`} style={{ color: 'var(--admin-ink)' }}>{r.tenantName}</td>
                    <td className={td} style={{ color: 'var(--admin-ink)' }}>{r.count}</td>
                    <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{r.lastAt === null ? '—' : fmt.dt(r.lastAt)}</td>
                    <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{r.lastError ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
