import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Activity, AlertOctagon, TrendingUp } from 'lucide-react'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { DatePicker } from '@/components/admin/DatePicker'
import { useFmt } from '@/lib/datetime'
import { listDevices } from '@/lib/devices'
import { EVENT_KINDS, listEvents, localizedEventSummary, type EventRow } from '@/lib/events'
import { dayEndIso, dayStartIso } from '@/lib/playback'
import { useUnits } from '@/lib/units'

const PAGE = 50

// adopted DataTable skin for the cursor-paginated table (audit.tsx precedent — the shared
// DataTable component cannot page a server cursor, so only the styling is shared)
const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }

/** Severity per kind — safety-critical events read as danger; degraded ones warn; the rest inform.
 * Drives both the badge tone and the StatCard counts over the currently loaded rows. */
type Severity = 'critical' | 'warning' | 'info'
const SEVERITY: Record<string, Severity> = {
  panic: 'critical',
  power_cut: 'critical',
  overspeed: 'warning',
  low_battery: 'warning',
  device_offline: 'warning',
}
const severityOf = (kind: string): Severity => SEVERITY[kind] ?? 'info'
const TONE: Record<Severity, 'danger' | 'warning' | 'info'> = { critical: 'danger', warning: 'warning', info: 'info' }
const SEV_ICON: Record<Severity, typeof Activity> = { critical: AlertOctagon, warning: TrendingUp, info: Activity }
const SEV_COLOR: Record<Severity, string> = { critical: 'var(--admin-danger)', warning: 'var(--admin-warning)', info: 'var(--admin-info)' }
const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

/** Events timeline (E05-6): the pipeline's rule/geofence output. Filter by kind, device,
 * and time range; expand a row for the raw payload. Cursor-paginated (newest first). */
export function EventsPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const u = useUnits()
  const [kind, setKind] = useState('')
  const [severity, setSeverity] = useState<'' | Severity>('')
  const [deviceId, setDeviceId] = useState('')
  // DatePicker filters are date-only (ADR-028 round-2 amendment): an unset day leaves the
  // bound open; a picked day queries its full local day
  const [from, setFrom] = useState<Date | undefined>(undefined)
  const [to, setTo] = useState<Date | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)

  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const fromIso = from !== undefined ? dayStartIso(from) : undefined
  const toIso = to !== undefined ? dayEndIso(to) : undefined

  const query = useInfiniteQuery({
    queryKey: ['events', kind, deviceId, fromIso ?? '', toIso ?? ''],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listEvents({
        limit: PAGE,
        ...(kind ? { kind } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(fromIso !== undefined ? { from: fromIso } : {}),
        ...(toIso !== undefined ? { to: toIso } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last: EventRow[]) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  })

  const rows = (query.data?.pages ?? []).flat()
  // severity is a client-side lens over the LOADED rows only — the cursor query is untouched
  // (severity is derived from kind, so the server cannot filter it)
  const shown = severity === '' ? rows : rows.filter((r) => severityOf(r.kind) === severity)
  const deviceName = (id: string): string => devices.data?.find((d) => d.id === id)?.name ?? id

  // stat row counts what is currently loaded (it's an infinite query — not a server aggregate)
  const critical = rows.filter((r) => severityOf(r.kind) === 'critical').length
  const warning = rows.filter((r) => severityOf(r.kind) === 'warning').length
  const info = rows.length - critical - warning

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('events.title')} description={t('events.desc')} className="mb-0">
        <div className="w-40">
          <Combobox aria-label={t('events.kind')} value={kind} onChange={setKind} data-testid="events-kind"
            options={[{ value: '', label: t('events.allKinds') }, ...EVENT_KINDS.map((k) => ({ value: k, label: t(`events.k.${k}`) }))]} />
        </div>
        <div className="w-40">
          <Combobox aria-label={t('events.severity')} value={severity} onChange={(v) => setSeverity(v as '' | Severity)} data-testid="events-severity"
            options={[{ value: '', label: t('events.allSeverities') }, ...SEVERITIES.map((sv) => ({ value: sv, label: t(`events.sev.${sv}`) }))]} />
        </div>
        <div className="w-40">
          <Combobox aria-label={t('events.device')} value={deviceId} onChange={setDeviceId} data-testid="events-device"
            options={[{ value: '', label: t('events.allDevices') }, ...(devices.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
        </div>
        <div className="w-36"><DatePicker aria-label={t('events.from')} value={from} onChange={setFrom} data-testid="events-from" /></div>
        <div className="w-36"><DatePicker aria-label={t('events.to')} value={to} onChange={setTo} data-testid="events-to" /></div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t('events.stat.critical')} value={<span className="inline-flex items-center gap-2"><AlertOctagon className="h-5 w-5" style={{ color: 'var(--admin-danger)' }} />{critical}</span>} />
        <StatCard label={t('events.stat.warning')} value={<span className="inline-flex items-center gap-2"><TrendingUp className="h-5 w-5" style={{ color: 'var(--admin-warning)' }} />{warning}</span>} />
        <StatCard label={t('events.stat.info')} value={<span className="inline-flex items-center gap-2"><Activity className="h-5 w-5" style={{ color: 'var(--admin-info)' }} />{info}</span>} />
      </div>

      <div className="admin-card overflow-hidden">
        {query.isError ? (
          <p role="alert" className="py-10 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="events-error">{t('admin.loadError')}</p>
        ) : shown.length === 0 && !query.isLoading ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="events-empty">{t('events.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="events-table">
              <thead>
                <tr style={{ background: 'var(--admin-surface-sunken)' }}>
                  <th className={th} style={thStyle}>{t('events.when')}</th>
                  <th className={th} style={thStyle}>{t('events.kind')}</th>
                  <th className={th} style={thStyle}>{t('events.device')}</th>
                  <th className={th} style={thStyle}>{t('events.detail')}</th>
                  <th className={`${th} hidden md:table-cell`} style={thStyle}>{t('events.severity')}</th>
                  <th className="px-4 py-2.5"><span className="sr-only">{t('events.details')}</span></th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--admin-ink)' }}>
                {shown.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="admin-hairline-b transition-colors hover:bg-[var(--admin-surface-sunken)]" data-testid={`event-row-${r.id}`}>
                      <td className="px-4 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{dt(r.at)}</td>
                      <td className="px-4 py-2.5"><Badge tone={TONE[severityOf(r.kind)]}>{t(`events.k.${r.kind}`, r.kind)}</Badge></td>
                      <td className="px-4 py-2.5">{deviceName(r.deviceId)}</td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--admin-ink-soft)' }}>{localizedEventSummary(t, r, { fmtSpeed: u.speed })}</td>
                      <td className="hidden px-4 py-2.5 md:table-cell" style={{ color: 'var(--admin-ink-soft)' }}>
                        {(() => {
                          const sev = severityOf(r.kind)
                          const Icon = SEV_ICON[sev]
                          return (
                            <span className="inline-flex items-center gap-1.5 text-xs">
                              <Icon className="h-3.5 w-3.5" style={{ color: SEV_COLOR[sev] }} aria-hidden />
                              {t(`events.sev.${sev}`)}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <AdminButton variant="ghost" size="sm" data-testid={`event-expand-${r.id}`} aria-expanded={open === r.id} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                          {open === r.id ? t('events.hide') : t('events.details')}
                        </AdminButton>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr data-testid={`event-detail-${r.id}`}>
                        <td colSpan={6} className="p-3" style={{ background: 'var(--admin-surface-sunken)' }}>
                          <pre className="max-h-64 overflow-auto rounded-md border p-2 text-xs" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}>{JSON.stringify(r.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {query.hasNextPage && (
          <div className="admin-hairline-t p-3 text-center">
            <AdminButton variant="secondary" size="sm" data-testid="events-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {t('events.loadMore')}
            </AdminButton>
          </div>
        )}
      </div>
    </div>
  )
}
