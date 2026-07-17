import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Activity, AlertOctagon, TrendingUp } from 'lucide-react'
import { Fragment, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { useFmt } from '@/lib/datetime'
import { listDevices } from '@/lib/devices'
import { EVENT_KINDS, listEvents, localizedEventSummary, type EventRow } from '@/lib/events'

const PAGE = 50

const selectCls = 'h-8 rounded-md border px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--admin-brand)]/30'
const selectStyle: CSSProperties = { borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }

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

/** Events timeline (E05-6): the pipeline's rule/geofence output. Filter by kind, device,
 * and time range; expand a row for the raw payload. Cursor-paginated (newest first). */
export function EventsPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const [kind, setKind] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  // datetime-local → ISO; an empty/partial value is dropped so it never bounds the query
  const iso = (v: string): string | undefined => {
    if (v === '') return undefined
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }

  const query = useInfiniteQuery({
    queryKey: ['events', kind, deviceId, from, to],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listEvents({
        limit: PAGE,
        ...(kind ? { kind } : {}),
        ...(deviceId ? { deviceId } : {}),
        ...(iso(from) ? { from: iso(from) } : {}),
        ...(iso(to) ? { to: iso(to) } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last: EventRow[]) => (last.length === PAGE ? last[last.length - 1]!.id : undefined),
  })

  const rows = (query.data?.pages ?? []).flat()
  const deviceName = (id: string): string => devices.data?.find((d) => d.id === id)?.name ?? id

  // stat row counts what is currently loaded (it's an infinite query — not a server aggregate)
  const critical = rows.filter((r) => severityOf(r.kind) === 'critical').length
  const warning = rows.filter((r) => severityOf(r.kind) === 'warning').length
  const info = rows.length - critical - warning

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title={t('events.title')} description={t('events.desc')} className="mb-0">
        <select aria-label={t('events.kind')} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="events-kind" className={selectCls} style={selectStyle}>
          <option value="">{t('events.allKinds')}</option>
          {EVENT_KINDS.map((k) => <option key={k} value={k}>{t(`events.k.${k}`)}</option>)}
        </select>
        <select aria-label={t('events.device')} value={deviceId} onChange={(e) => setDeviceId(e.target.value)} data-testid="events-device" className={selectCls} style={selectStyle}>
          <option value="">{t('events.allDevices')}</option>
          {(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input type="datetime-local" aria-label={t('events.from')} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="events-from" className={selectCls} style={selectStyle} />
        <input type="datetime-local" aria-label={t('events.to')} value={to} onChange={(e) => setTo(e.target.value)} data-testid="events-to" className={selectCls} style={selectStyle} />
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t('events.stat.critical')} value={<span className="inline-flex items-center gap-2"><AlertOctagon className="h-5 w-5" style={{ color: 'var(--admin-danger)' }} />{critical}</span>} />
        <StatCard label={t('events.stat.warning')} value={<span className="inline-flex items-center gap-2"><TrendingUp className="h-5 w-5" style={{ color: 'var(--admin-warning)' }} />{warning}</span>} />
        <StatCard label={t('events.stat.info')} value={<span className="inline-flex items-center gap-2"><Activity className="h-5 w-5" style={{ color: 'var(--admin-info)' }} />{info}</span>} />
      </div>

      <div className="admin-card overflow-hidden">
        {rows.length === 0 && !query.isLoading ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="events-empty">{t('events.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="events-table">
              <thead style={{ background: 'var(--admin-surface-sunken)' }}>
                <tr className="text-left text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                  <th className="px-3 py-2 font-medium">{t('events.when')}</th>
                  <th className="px-3 py-2 font-medium">{t('events.kind')}</th>
                  <th className="px-3 py-2 font-medium">{t('events.device')}</th>
                  <th className="px-3 py-2 font-medium">{t('events.detail')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody style={{ color: 'var(--admin-ink)' }}>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="border-t" style={{ borderColor: 'var(--admin-hairline)' }} data-testid={`event-row-${r.id}`}>
                      <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{dt(r.at)}</td>
                      <td className="px-3 py-2"><Badge tone={TONE[severityOf(r.kind)]}>{t(`events.k.${r.kind}`, r.kind)}</Badge></td>
                      <td className="px-3 py-2">{deviceName(r.deviceId)}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--admin-ink-soft)' }}>{localizedEventSummary(t, r)}</td>
                      <td className="px-3 py-2 text-right">
                        <AdminButton variant="ghost" size="sm" data-testid={`event-expand-${r.id}`} aria-expanded={open === r.id} onClick={() => setOpen((o) => (o === r.id ? null : r.id))}>
                          {open === r.id ? t('events.hide') : t('events.details')}
                        </AdminButton>
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr data-testid={`event-detail-${r.id}`}>
                        <td colSpan={5} className="p-3" style={{ background: 'var(--admin-surface-sunken)' }}>
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
