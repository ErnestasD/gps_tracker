import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Badge, EmptyState, PageHeader } from '@/components/admin/AdminKit'
import { useFmt } from '@/lib/datetime'
import { consoleLapses, type ConsoleLapse } from '@/lib/console'

/**
 * Who is late, and how close they are to losing their fleet.
 *
 * The lapse ladder already RUNS — it warns three times and then disconnects a paying customer's
 * entire fleet — and until now there was no screen anywhere that showed it. The only way to know a
 * customer was one day from being cut off was to query the database. That is the gap this page
 * exists to close, and it is why "who is at stage 3" is the first thing it sorts on.
 */
const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const td = 'px-4 py-2.5'

/** 0 none · 1 grace-end · 2 day+1 · 3 day+2 (final — the next run suspends them). */
function stageTone(stage: number, suspended: boolean): 'danger' | 'warning' | 'neutral' {
  if (suspended) return 'danger'
  if (stage >= 3) return 'danger'
  if (stage >= 1) return 'warning'
  return 'neutral'
}

export function ConsoleLapsesPage() {
  const { t } = useTranslation()
  const fmt = useFmt()
  const q = useQuery({ queryKey: ['console', 'lapses'], queryFn: consoleLapses })

  const rows: ConsoleLapse[] = q.data ?? []

  return (
    <div className="flex flex-col gap-6" data-testid="console-lapses">
      <PageHeader title={t('console.lapses.title')} description={t('console.lapses.desc')} />

      {q.isError && (
        <p role="alert" className="admin-card p-4 text-sm" style={{ color: 'var(--admin-danger)' }}>
          {t('console.loadError')}
        </p>
      )}

      {!q.isLoading && !q.isError && rows.length === 0 && (
        // An empty list here is GOOD NEWS and must read as such — a bare "no results" on a screen
        // about unpaid invoices looks like a broken query.
        <EmptyState title={t('console.lapses.emptyTitle')} description={t('console.lapses.emptyDesc')} data-testid="console-lapses-empty" />
      )}

      {rows.length > 0 && (
        <div className="admin-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="admin-hairline-b">
                <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.lapses.tenant')}</th>
                <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.lapses.plan')}</th>
                <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.lapses.stage')}</th>
                <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.lapses.periodEnd')}</th>
                <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.lapses.devices')}</th>
                <th className={th} style={{ color: 'var(--admin-ink-soft)' }}>{t('console.lapses.contact')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenantId} className="admin-hairline-b" data-testid={`lapse-${r.tenantId}`}>
                  <td className={`${td} font-medium`} style={{ color: 'var(--admin-ink)' }}>{r.tenantName}</td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{r.plan}</td>
                  <td className={td}>
                    <Badge tone={stageTone(r.lapseNoticeStage, r.suspendedAt !== null)}>
                      {r.suspendedAt !== null
                        ? t('console.lapses.suspended')
                        : t('console.lapses.stageN', { stage: r.lapseNoticeStage })}
                    </Badge>
                    {r.suspendedAt === null && r.lapseNoticeStage >= 3 && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--admin-danger)' }}>
                        {t('console.lapses.nextRunSuspends')}
                      </span>
                    )}
                  </td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>
                    {r.currentPeriodEnd === null ? '—' : fmt.d(r.currentPeriodEnd)}
                  </td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{r.activeDevices}</td>
                  <td className={td} style={{ color: 'var(--admin-ink-soft)' }}>{r.billingEmail ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
