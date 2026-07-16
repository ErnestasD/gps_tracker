import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { getLastPositions } from '@/lib/api'
import { dailyKmSeries, eventSeverity, fleetCounts } from '@/lib/dashboard'
import { listAccounts, listDevices } from '@/lib/devices'
import { eventSummary, listEvents } from '@/lib/events'
import { runReport } from '@/lib/reports'

/**
 * Apžvalga — overview dashboard (ADR-028 design's app.index, built from REAL data only:
 * devices, last positions, 24 h events, 7 d mileage report). No mock numbers.
 */
export function DashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const now = Date.now()
  const dayAgo = new Date(now - 24 * 3_600_000).toISOString()
  const weekAgo = new Date(now - 7 * 24 * 3_600_000).toISOString()

  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const positions = useQuery({ queryKey: ['dash-positions'], queryFn: getLastPositions, refetchInterval: 30_000 })
  const events = useQuery({ queryKey: ['dash-events'], queryFn: () => listEvents({ from: dayAgo, limit: 50 }), refetchInterval: 60_000 })
  // mileage needs an account scope — tenant-wide admins report on the first account (like reports.tsx)
  const acc = accounts.data?.[0]?.id
  const mileage = useQuery({
    queryKey: ['dash-mileage', acc],
    queryFn: () => runReport('mileage', { accountId: acc!, from: weekAgo, to: new Date(now).toISOString() }),
    enabled: acc !== undefined,
    staleTime: 5 * 60_000,
  })

  const live = devices.data?.filter((d) => !d.retiredAt) ?? []
  const counts = fleetCounts(positions.data ?? [], now)
  const rows = events.data ?? []
  const critical = rows.filter((e) => eventSeverity(e.kind) === 'critical').length
  const series = dailyKmSeries(mileage.data?.rows ?? [])
  const weekKm = Math.round(series.reduce((s, d) => s + d.km, 0) * 10) / 10
  const recent = rows.slice(0, 8)
  const deviceName = new Map(live.map((d) => [String(d.id), d.name]))
  const latest = [...(positions.data ?? [])].sort((a, b) => b.fixTimeMs - a.fixTimeMs).slice(0, 5)
  const maxKm = Math.max(1, ...series.map((s) => s.km))

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('dash.title')} description={t('dash.desc')}>
        <AdminButton variant="secondary" onClick={() => void navigate({ to: '/app/reports' })}>{t('dash.toReports')}</AdminButton>
        <AdminButton onClick={() => void navigate({ to: '/app/map' })}>{t('dash.toMap')}</AdminButton>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard data-testid="dash-devices" label={t('dash.devices')} value={live.length} hint={t('dash.retiredHint', { n: (devices.data?.length ?? 0) - live.length })} />
        <StatCard data-testid="dash-online" label={t('dash.online')} value={counts.online} hint={t('dash.staleHint', { n: counts.stale })} />
        <StatCard data-testid="dash-events" label={t('dash.events24')} value={rows.length >= 50 ? '50+' : rows.length} />
        <StatCard data-testid="dash-critical" label={t('dash.critical24')} value={critical} {...(critical > 0 ? { delta: { value: String(critical), tone: 'down' as const } } : {})} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 7d mileage — hand-rolled SVG bars (no chart dep, ADR-028) */}
        <section className="admin-card">
          <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('dash.mileage7')}</h2>
            {acc !== undefined && series.length > 0 && <Badge tone="brand">{t('units.km', { n: weekKm })}</Badge>}
          </div>
          <div className="p-4">
            {acc === undefined ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.noAccount')}</p>
            ) : series.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="dash-mileage-empty">{t('dash.empty')}</p>
            ) : (
              <svg viewBox={`0 0 ${series.length * 40} 120`} className="h-36 w-full" preserveAspectRatio="none" data-testid="dash-mileage-chart" role="img" aria-label={t('dash.mileage7')}>
                {series.map((d, i) => {
                  const h = Math.max(2, (d.km / maxKm) * 96)
                  return (
                    <g key={d.day}>
                      <rect x={i * 40 + 8} y={100 - h} width={24} height={h} rx={3} fill="var(--admin-brand)" opacity={0.85} />
                      <text x={i * 40 + 20} y={114} textAnchor="middle" fontSize={9} fill="var(--admin-ink-soft)">{d.day.slice(5)}</text>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>
        </section>

        {/* latest reporting devices */}
        <section className="admin-card">
          <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('dash.latestDevices')}</h2>
            <AdminButton variant="ghost" size="sm" onClick={() => void navigate({ to: '/app/devices' })}>{t('dash.viewAll')}</AdminButton>
          </div>
          <ul data-testid="dash-latest">
            {latest.length === 0 && <li className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.empty')}</li>}
            {latest.map((p) => {
              const age = now - p.fixTimeMs
              const tone = age <= 60_000 ? 'success' : age <= 600_000 ? 'warning' : 'neutral'
              return (
                <li key={p.deviceId} className="admin-hairline-b flex items-center gap-3 px-4 py-2.5 text-sm last:border-b-0">
                  <span className="min-w-0 flex-1 truncate font-medium" style={{ color: 'var(--admin-ink)' }}>{deviceName.get(p.deviceId) ?? p.deviceId}</span>
                  {p.speed !== null && <span className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{Math.round(p.speed)} km/h</span>}
                  <Badge tone={tone}>{t(tone === 'success' ? 'status.online' : tone === 'warning' ? 'status.stale' : 'status.offline')}</Badge>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {/* recent events */}
      <section className="admin-card">
        <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('dash.recent')}</h2>
          <AdminButton variant="ghost" size="sm" onClick={() => void navigate({ to: '/app/events' })}>{t('dash.viewAll')}</AdminButton>
        </div>
        <ul data-testid="dash-recent">
          {recent.length === 0 && <li className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.empty')}</li>}
          {recent.map((e) => {
            const sev = eventSeverity(e.kind)
            return (
              <li key={e.id} className="admin-hairline-b flex items-center gap-3 px-4 py-2.5 text-sm last:border-b-0">
                <Badge tone={sev === 'critical' ? 'danger' : sev === 'warning' ? 'warning' : 'info'}>{t(`events.k.${e.kind}`, e.kind)}</Badge>
                <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--admin-ink)' }}>{eventSummary(e)}</span>
                <span className="mono text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{e.deviceId}</span>
                <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{new Date(e.at).toLocaleString()}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
