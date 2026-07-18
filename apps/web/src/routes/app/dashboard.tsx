import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Activity, AlertTriangle, Bell } from 'lucide-react'

import { AdminButton, Badge, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { AreaChartSvg, DonutSvg, HourlyBarsSvg, kindColor } from '@/components/admin/Charts'
import { getLastPositions } from '@/lib/api'
import { countDelta, dailyActiveDevices, dailyCounts, dailyKmSeries, dayStrInTz, eventSeverity, fleetCounts, hourInTz, hourlyBuckets, kindBreakdown, pctDelta } from '@/lib/dashboard'
import { useFmt } from '@/lib/datetime'
import { listAccounts, listDevices } from '@/lib/devices'
import { listEvents, localizedEventSummary } from '@/lib/events'
import { runReport } from '@/lib/reports'
import { useUnits } from '@/lib/units'

/**
 * Apžvalga — overview dashboard (ADR-028 design's app.index, built from REAL data only:
 * devices, last positions, 24 h + prior-24 h + 7 d events, and the mileage report over a
 * selectable 7/30/90 d range). No mock numbers — every figure traces to an API response.
 */

/** Events fetch cap per window (API clamps limit to 1000; 300 keeps payloads small).
 *  A full page means the count is a floor → rendered as "300+". */
const EVENTS_CAP = 300
const RANGES = [7, 30, 90] as const
type RangeDays = (typeof RANGES)[number]

export function DashboardPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const u = useUnits()
  const navigate = useNavigate()
  const [rangeDays, setRangeDays] = useState<RangeDays>(7)
  const now = Date.now()
  const dayAgo = new Date(now - 24 * 3_600_000).toISOString()
  const twoDaysAgo = new Date(now - 48 * 3_600_000).toISOString()
  const weekAgo = new Date(now - 7 * 24 * 3_600_000).toISOString()

  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const positions = useQuery({ queryKey: ['dash-positions'], queryFn: getLastPositions, refetchInterval: 30_000 })
  const events = useQuery({ queryKey: ['dash-events'], queryFn: () => listEvents({ from: dayAgo, limit: EVENTS_CAP }), refetchInterval: 60_000 })
  // prior-24 h window (for the vs-previous deltas) and the 7 d window (donut, hourly, sparks)
  // move slowly — refresh every 5 min instead of every minute
  const eventsPrev = useQuery({ queryKey: ['dash-events-prev24'], queryFn: () => listEvents({ from: twoDaysAgo, to: dayAgo, limit: EVENTS_CAP }), staleTime: 5 * 60_000, refetchInterval: 5 * 60_000 })
  const events7 = useQuery({ queryKey: ['dash-events-7d'], queryFn: () => listEvents({ from: weekAgo, limit: EVENTS_CAP }), staleTime: 60_000, refetchInterval: 5 * 60_000 })
  // mileage needs an account scope — tenant-wide admins report on the first account (like reports.tsx)
  const acc = accounts.data?.[0]?.id
  const mileage = useQuery({
    queryKey: ['dash-mileage', acc, rangeDays],
    queryFn: () => runReport('mileage', { accountId: acc!, from: new Date(now - rangeDays * 24 * 3_600_000).toISOString(), to: new Date(now).toISOString() }),
    enabled: acc !== undefined,
    staleTime: 5 * 60_000,
  })

  const live = devices.data?.filter((d) => !d.retiredAt) ?? []
  const deviceName = new Map(live.map((d) => [String(d.id), d.name]))
  const devicePlate = new Map(live.map((d) => [String(d.id), d.plate]))
  // presence/latest count only live (non-retired) devices, so they agree with the Devices stat
  const livePositions = (positions.data ?? []).filter((p) => deviceName.has(String(p.deviceId)))
  const counts = fleetCounts(livePositions, now)
  const latest = [...livePositions].sort((a, b) => b.fixTimeMs - a.fixTimeMs).slice(0, 5)

  // ── events: 24 h count + deltas vs the PRIOR 24 h; 7 d rows feed donut/hourly/sparks ──
  const rows24 = events.data ?? []
  const rowsPrev = eventsPrev.data ?? []
  const rows7 = events7.data ?? []
  // a full page means the true count is unknown (floor) — render "300+" and no delta
  const trunc24 = rows24.length >= EVENTS_CAP
  const truncPrev = rowsPrev.length >= EVENTS_CAP
  const trunc7 = rows7.length >= EVENTS_CAP
  const critical = rows24.filter((e) => eventSeverity(e.kind) === 'critical').length
  const criticalPrev = rowsPrev.filter((e) => eventSeverity(e.kind) === 'critical').length
  const eventsDelta = trunc24 || truncPrev ? null : countDelta(rows24.length, rowsPrev.length)
  const criticalDelta = trunc24 || truncPrev ? null : countDelta(critical, criticalPrev)
  // bucket days/hours on the display-pref timezone (not the browser zone) so the dashboard agrees
  // with the account-tz report buckets and with the event times rendered everywhere else
  const tz = u.prefs.timeZone !== 'auto' ? u.prefs.timeZone : undefined
  const dayOfTz = (iso: string) => dayStrInTz(Date.parse(iso), tz)
  const eventsSpark = dailyCounts(rows7, 7, now, dayOfTz)
  const criticalSpark = dailyCounts(rows7.filter((e) => eventSeverity(e.kind) === 'critical'), 7, now, dayOfTz)
  const hourly = hourlyBuckets(rows7, (iso) => hourInTz(iso, tz))
  const breakdown = kindBreakdown(rows7)
  const recent = rows24.slice(0, 6)

  // ── mileage: range series for the area chart; today/yesterday + sparks from the same rows ──
  const series = dailyKmSeries(mileage.data?.rows ?? [])
  const rangeKm = Math.round(series.reduce((s, d) => s + d.km, 0) * 10) / 10
  const kmSpark = series.slice(-7).map((s) => s.km)
  const activeSpark = dailyActiveDevices(mileage.data?.rows ?? []).slice(-7).map((s) => s.count)
  const yest = new Date(now)
  yest.setDate(yest.getDate() - 1)
  // the mileage series `day` is bucketed by the ACCOUNT timezone server-side (reports route forces
  // account.timezone), so match today/yesterday on THAT zone — not the display-pref tz — or the
  // lookup can miss by a day for a user whose display tz differs from their account (review MED)
  const acctTz = accounts.data?.[0]?.timezone
  const todayKm = series.find((s) => s.day === dayStrInTz(now, acctTz))?.km ?? 0
  const yesterdayKm = series.find((s) => s.day === dayStrInTz(yest.getTime(), acctTz))?.km ?? 0
  const kmDelta = mileage.data !== undefined ? pctDelta(todayKm, yesterdayKm) : null
  // multi-account tenants: say WHICH account the mileage widgets cover (mirrors reports.tsx's
  // first-account default but had no scope indication)
  const accName = (accounts.data ?? []).length > 1 ? accounts.data?.[0]?.name : undefined

  const skel = (w: string) => <span className={`admin-skeleton inline-block h-7 ${w}`} aria-hidden />
  const floor = (n: number, truncated: boolean): string => `${n}${truncated ? '+' : ''}`

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('dash.title')} description={t('dash.desc')}>
        <AdminButton variant="secondary" onClick={() => void navigate({ to: '/app/reports' })}>{t('dash.toReports')}</AdminButton>
        <AdminButton onClick={() => void navigate({ to: '/app/map' })}>{t('dash.toMap')}</AdminButton>
      </PageHeader>

      {/* ── stat row ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          data-testid="dash-devices"
          label={t('dash.active')}
          value={devices.isError || positions.isError ? '—' : devices.isLoading || positions.isLoading ? skel('w-16') : (
            <>
              <span data-testid="dash-online">{counts.online}</span>
              <span className="text-base font-normal opacity-50"> / {live.length}</span>
            </>
          )}
          hint={devices.isError || positions.isError ? t('dash.error') : t('dash.staleHint', { n: counts.stale })}
          {...(activeSpark.length > 1 ? { spark: activeSpark } : {})}
        />
        <StatCard
          data-testid="dash-today"
          label={t('dash.today')}
          value={accounts.isError || mileage.isError ? '—' : acc === undefined && !accounts.isLoading ? '—' : mileage.data === undefined ? skel('w-20') : (
            <>{u.toDistance(todayKm)} <span className="text-base font-normal opacity-50">{u.distanceLabel}</span></>
          )}
          hint={accounts.isError || mileage.isError ? t('dash.error') : acc === undefined && !accounts.isLoading ? t('dash.noAccount') : t('dash.vsYesterday')}
          {...(kmDelta !== null ? { delta: kmDelta } : {})}
          {...(kmSpark.length > 1 ? { spark: kmSpark } : {})}
        />
        <StatCard
          data-testid="dash-events"
          label={t('dash.events24')}
          value={events.isError ? '—' : events.isLoading ? skel('w-12') : floor(rows24.length, trunc24)}
          hint={events.isError ? t('dash.error') : t('dash.vsPrev24')}
          {...(eventsDelta !== null ? { delta: { ...eventsDelta, sentiment: 'neutral' as const } } : {})}
          {...(eventsSpark.some((n) => n > 0) ? { spark: eventsSpark } : {})}
        />
        {/* critical delta: more criticals is BAD — red badge even when the arrow points up */}
        <StatCard
          data-testid="dash-critical"
          label={t('dash.critical24')}
          value={events.isError ? '—' : events.isLoading ? skel('w-12') : floor(critical, trunc24)}
          hint={events.isError ? t('dash.error') : t('dash.vsPrev24')}
          {...(criticalDelta !== null ? { delta: { ...criticalDelta, sentiment: criticalDelta.tone === 'up' ? ('bad' as const) : criticalDelta.tone === 'down' ? ('good' as const) : ('neutral' as const) } } : {})}
          {...(criticalSpark.some((n) => n > 0) ? { spark: criticalSpark } : {})}
        />
      </div>

      {/* ── fleet activity (area, 7/30/90 d) + events-by-kind donut ───────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="admin-card lg:col-span-2">
          <div className="admin-hairline-b flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
                {t('dash.fleetActivity')}
                {accName !== undefined && (
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--admin-ink-soft)' }} data-testid="dash-mileage-account">{accName}</span>
                )}
              </h2>
              <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.fleetActivityDesc')}</p>
            </div>
            <div className="flex items-center gap-2">
              {acc !== undefined && series.length > 0 && <Badge tone="brand">{u.distanceKm(rangeKm)}</Badge>}
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    data-testid={`dash-range-${r}d`}
                    onClick={() => setRangeDays(r)}
                    aria-pressed={rangeDays === r}
                    className="rounded-md px-2.5 py-1 text-xs transition-colors"
                    style={{
                      background: rangeDays === r ? 'var(--admin-brand-soft)' : 'transparent',
                      color: rangeDays === r ? 'var(--admin-brand)' : 'var(--admin-ink-soft)',
                      fontWeight: rangeDays === r ? 600 : 500,
                    }}
                  >
                    {t(`dash.range${r}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="p-4">
            {accounts.isError || mileage.isError ? (
              <p role="alert" className="py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="dash-mileage-error">{t('dash.error')}</p>
            ) : acc === undefined && !accounts.isLoading ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.noAccount')}</p>
            ) : mileage.data === undefined ? (
              <div className="admin-skeleton h-52 w-full" aria-hidden />
            ) : series.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="dash-mileage-empty">{t('dash.empty')}</p>
            ) : (
              <AreaChartSvg series={series.map((s) => ({ day: s.day, km: u.toDistance(s.km) }))} unit={u.distanceLabel} data-testid="dash-mileage-chart" aria-label={t('dash.fleetActivity')} />
            )}
          </div>
        </section>

        <section className="admin-card">
          <div className="admin-hairline-b px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('dash.events7')}</h2>
            <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.byType')}</p>
          </div>
          <div className="p-4">
            {events7.isError ? (
              <p role="alert" className="py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="dash-donut-error">{t('dash.error')}</p>
            ) : events7.isLoading ? (
              <div className="admin-skeleton mx-auto h-44 w-44 !rounded-full" aria-hidden />
            ) : breakdown.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.empty')}</p>
            ) : (
              <>
                <DonutSvg breakdown={breakdown} centerValue={floor(rows7.length, trunc7)} centerLabel={t('dash.totalShort')} label={(k) => t(`events.k.${k}`, k)} data-testid="dash-donut" aria-label={t('dash.events7')} />
                <ul className="mt-3 space-y-1.5">
                  {breakdown.map((b, i) => (
                    <li key={b.kind} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2" style={{ color: 'var(--admin-ink)' }}>
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: kindColor(i) }} />
                        <span className="truncate">{t(`events.k.${b.kind}`, b.kind)}</span>
                      </span>
                      <span className="mono" style={{ color: 'var(--admin-ink-soft)' }}>{b.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ── events by hour of day + top (latest-reporting) devices ────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="admin-card lg:col-span-2">
          <div className="admin-hairline-b px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('dash.hourly')}</h2>
            <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.byHour')}</p>
          </div>
          <div className="p-4">
            {events7.isError ? (
              <p role="alert" className="py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="dash-hourly-error">{t('dash.error')}</p>
            ) : events7.isLoading ? (
              <div className="admin-skeleton h-36 w-full" aria-hidden />
            ) : rows7.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.empty')}</p>
            ) : (
              <HourlyBarsSvg buckets={hourly} unit={t('dash.eventsUnit')} data-testid="dash-hourly" aria-label={t('dash.byHour')} />
            )}
          </div>
        </section>

        <section className="admin-card overflow-hidden">
          <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('dash.latestDevices')}</h2>
            <AdminButton variant="ghost" size="sm" onClick={() => void navigate({ to: '/app/devices' })}>{t('dash.viewAll')}</AdminButton>
          </div>
          <ul data-testid="dash-latest">
            {positions.isError && <li role="alert" className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="dash-latest-error">{t('dash.error')}</li>}
            {!positions.isError && latest.length === 0 && <li className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.empty')}</li>}
            {latest.map((p) => {
              const age = now - p.fixTimeMs
              const tone = age <= 60_000 ? 'success' : age <= 600_000 ? 'warning' : 'neutral'
              const plate = devicePlate.get(p.deviceId)
              const sub = [plate ?? null, p.speed !== null ? u.speed(p.speed) : null].filter((s) => s !== null).join(' · ')
              return (
                <li key={p.deviceId} className="admin-hairline-b flex items-center justify-between gap-3 px-4 py-2.5 text-sm last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate font-medium" style={{ color: 'var(--admin-ink)' }}>{deviceName.get(p.deviceId) ?? p.deviceId}</div>
                    {sub !== '' && <div className="truncate text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{sub}</div>}
                  </div>
                  <Badge tone={tone}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden />
                    {t(tone === 'success' ? 'status.online' : tone === 'warning' ? 'status.stale' : 'status.offline')}
                  </Badge>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {/* ── recent events (severity icon + summary + kind badge + time) ───────── */}
      <section className="admin-card overflow-hidden">
        <div className="admin-hairline-b flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('dash.recent')}</h2>
          <AdminButton variant="ghost" size="sm" onClick={() => void navigate({ to: '/app/events' })}>{t('dash.viewAll')}</AdminButton>
        </div>
        <ul data-testid="dash-recent">
          {events.isError && <li role="alert" className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="dash-recent-error">{t('dash.error')}</li>}
          {!events.isError && recent.length === 0 && <li className="px-4 py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }}>{t('dash.empty')}</li>}
          {recent.map((e) => {
            const sev = eventSeverity(e.kind)
            const Icon = sev === 'critical' ? Bell : sev === 'warning' ? AlertTriangle : Activity
            return (
              <li key={e.id} className="admin-hairline-b flex items-center gap-3 px-4 py-2.5 text-sm last:border-b-0">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  style={{
                    background: sev === 'critical' ? 'var(--admin-danger-soft)' : sev === 'warning' ? 'var(--admin-warning-soft)' : 'var(--admin-info-soft)',
                    color: sev === 'critical' ? 'var(--admin-danger)' : sev === 'warning' ? 'var(--admin-warning)' : 'var(--admin-info)',
                  }}
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate" style={{ color: 'var(--admin-ink)' }}>{localizedEventSummary(t, e, { fmtSpeed: u.speed, fmtVolume: u.volumeL })}</div>
                  <div className="truncate text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                    {deviceName.get(String(e.deviceId)) ?? e.deviceId} · {dt(e.at)}
                  </div>
                </div>
                <Badge tone={sev === 'critical' ? 'danger' : sev === 'warning' ? 'warning' : 'info'}>{t(`events.k.${e.kind}`, e.kind)}</Badge>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
