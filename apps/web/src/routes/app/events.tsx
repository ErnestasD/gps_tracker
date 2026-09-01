import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { Activity, AlertOctagon, TrendingUp } from 'lucide-react'
import { Fragment, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, Badge, PageHeader, StatCard } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { DatePicker } from '@/components/admin/DatePicker'
import { useFmt } from '@/lib/datetime'
import { listDevices } from '@/lib/devices'
import { EVENT_KINDS, eventFacts, eventSeverity, listEvents, localizedEventSummary, type EventRow, type EventSeverity } from '@/lib/events'
import { dayEndIso, dayStartIso } from '@/lib/playback'
import { getDisplayPrefs, onPrefsChange } from '@/lib/prefs'
import { useUnits } from '@/lib/units'

const PAGE = 50

// adopted DataTable skin for the cursor-paginated table (audit.tsx precedent — the shared
// DataTable component cannot page a server cursor, so only the styling is shared)
const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)' }

/** Severity per kind — safety-critical events read as danger; degraded ones warn; the rest inform.
 * Drives both the badge tone and the StatCard counts over the currently loaded rows. */
/** Severity comes from `lib/events`, not from a table here. This page had its own, driving the
 *  badge, the filter AND the Critical count — so one record could be an alarm on the map and
 *  absent from the very count meant to catch it. */
type Severity = EventSeverity
const severityOf = eventSeverity
const TONE: Record<Severity, 'danger' | 'warning' | 'info'> = { critical: 'danger', warning: 'warning', info: 'info' }
const SEV_ICON: Record<Severity, typeof Activity> = { critical: AlertOctagon, warning: TrendingUp, info: Activity }
const SEV_COLOR: Record<Severity, string> = { critical: 'var(--admin-danger)', warning: 'var(--admin-warning)', info: 'var(--admin-info)' }
const SEVERITIES: Severity[] = ['critical', 'warning', 'info']

/** Events timeline (E05-6): the pipeline's rule/geofence output. Filter by kind, device,
 * and time range; expand a row for the raw payload. Cursor-paginated (newest first). */
export function EventsPage() {
  // the bell hands us an event id; open it, once, without fighting the operator afterwards
  const { focus } = useSearch({ from: '/app/events' })
  const [open, setOpen] = useState<string | null>(focus ?? null)
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

  // day bounds follow the display-prefs time zone so the picked day matches the rendered `at` labels
  const prefs = useSyncExternalStore(onPrefsChange, getDisplayPrefs)
  const tz = prefs.timeZone !== 'auto' ? prefs.timeZone : undefined
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const fromIso = from !== undefined ? dayStartIso(from, tz) : undefined
  const toIso = to !== undefined ? dayEndIso(to, tz) : undefined

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
    // keyset token, not the bare id: the server orders by OCCURRENCE now (a buffered flush inserts
    // hours-old alerts with the newest ids), so a cursor on id alone would page through a different
    // order than the one being displayed and skip rows
    getNextPageParam: (last: EventRow[]) => {
      const tail = last[last.length - 1]
      return last.length === PAGE && tail !== undefined ? `${tail.at}|${tail.id}` : undefined
    },
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
    <div className="max-w-7xl space-y-4 p-4 md:p-6">
      {/* labeled filters with the shared gap — the bare glued controls read as off-standard
          next to trips/reports (founder feedback); FilterLabel mirrors trips.tsx */}
      <PageHeader title={t('events.title')} description={t('events.desc')} className="mb-0">
        <FilterLabel label={t('events.kind')}>
          <div className="w-40">
            <Combobox aria-label={t('events.kind')} value={kind} onChange={setKind} data-testid="events-kind"
              options={[{ value: '', label: t('events.allKinds') }, ...EVENT_KINDS.map((k) => ({ value: k, label: t(`events.k.${k}`) }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label={t('events.severity')}>
          <div className="w-40">
            <Combobox aria-label={t('events.severity')} value={severity} onChange={(v) => setSeverity(v as '' | Severity)} data-testid="events-severity"
              options={[{ value: '', label: t('events.allSeverities') }, ...SEVERITIES.map((sv) => ({ value: sv, label: t(`events.sev.${sv}`) }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label={t('events.device')}>
          <div className="w-40">
            <Combobox aria-label={t('events.device')} value={deviceId} onChange={setDeviceId} data-testid="events-device"
              options={[{ value: '', label: t('events.allDevices') }, ...(devices.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
        </FilterLabel>
        <FilterLabel label={t('events.from')}>
          <div className="w-36"><DatePicker aria-label={t('events.from')} value={from} onChange={setFrom} data-testid="events-from" /></div>
        </FilterLabel>
        <FilterLabel label={t('events.to')}>
          <div className="w-36"><DatePicker aria-label={t('events.to')} value={to} onChange={setTo} data-testid="events-to" /></div>
        </FilterLabel>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t('events.stat.critical')} value={<span className="inline-flex items-center gap-2"><AlertOctagon className="h-5 w-5" style={{ color: 'var(--admin-danger)' }} />{critical}</span>} />
        <StatCard label={t('events.stat.warning')} value={<span className="inline-flex items-center gap-2"><TrendingUp className="h-5 w-5" style={{ color: 'var(--admin-warning)' }} />{warning}</span>} />
        <StatCard label={t('events.stat.info')} value={<span className="inline-flex items-center gap-2"><Activity className="h-5 w-5" style={{ color: 'var(--admin-info)' }} />{info}</span>} />
      </div>
      {/* the counts + the client severity lens tally only the LOADED rows (this is a cursor query,
          not a server aggregate) — say so honestly when more pages exist so "Warning 0" isn't read
          as a fleet total */}
      {query.hasNextPage && (
        <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }} data-testid="events-stat-scope">{t('events.statScope', { n: rows.length })}</p>
      )}

      <div className="admin-card overflow-hidden">
        {query.isError ? (
          <p role="alert" className="py-10 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="events-error">{t('admin.loadError')}</p>
        ) : query.isLoading ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="events-loading">{t('admin.loading')}</p>
        ) : shown.length === 0 ? (
          // distinguish a genuinely empty result from the severity lens filtering out the loaded
          // page — the latter isn't "no events", it's "none on this page; load more to keep looking"
          <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="events-empty">
            {rows.length > 0 ? t('events.filteredEmpty') : t('events.empty')}
          </p>
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
                      <td className="px-4 py-2.5" style={{ color: 'var(--admin-ink-soft)' }}>{localizedEventSummary(t, r, { fmtSpeed: u.speed, fmtVolume: u.volumeL })}</td>
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
                          <EventDetails row={r} deviceName={deviceName(r.deviceId)} />
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

function FilterLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
      {label}
      {children}
    </label>
  )
}

/**
 * What happened, in parts — replacing `JSON.stringify(payload)`.
 *
 * The old panel showed the database's answer: our field names, our units, our nulls, and a
 * dispatcher asked to parse braces to learn a van was doing 105 in a 90 zone. Every fact here is
 * labelled and carries its own unit, and the three questions the founder said the feed could not
 * answer — what, where, when — are answered first and always, before anything kind-specific.
 *
 * A payload key this build has never seen is still listed, labelled by its own name. An unknown
 * field rendered plainly is untidy; an unknown field hidden is a screen an operator cannot trust.
 */
function EventDetails({ row, deviceName }: { row: EventRow; deviceName: string }) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const u = useUnits()
  const facts = eventFacts(row, {
    fmtSpeed: u.speed,
    fmtVolume: u.volumeL,
    onOff: (on) => (on ? t('events.f.on') : t('events.f.off')),
  })
  const place = typeof row.lat === 'number' && typeof row.lon === 'number' ? { lat: row.lat, lon: row.lon } : null

  return (
    <div className="admin-card p-3" data-testid={`event-facts-${row.id}`}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--admin-ink-soft)' }}>
        {t('events.f.title')}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label={t('events.f.when')} value={dt(row.at)} />
        <Fact label={t('events.f.device')} value={deviceName} />
        <Fact
          label={t('events.f.where')}
          value={
            place !== null ? (
              /*
               * Coordinates, and deliberately NO "show on map" link yet.
               *
               * The map has no way to be told "this device, at this instant": it reads no search
               * params, so a link would land on the vehicle's CURRENT position. For a speeding
               * event that is a different road, possibly a different city, presented as the place
               * it happened. A link that shows the wrong place is worse than a coordinate pair.
               * Wiring the map to accept a device + moment is the follow-up this is waiting on.
               */
              <span className="tabular-nums">{place.lat.toFixed(5)}, {place.lon.toFixed(5)}</span>
            ) : (
              t('events.f.noLocation')
            )
          }
        />
        {facts.map((f, i) => (
          <Fact
            key={`${f.key ?? f.rawLabel ?? ''}-${i}`}
            label={f.key === null ? (f.rawLabel ?? '') : t(f.key)}
            value={f.valueKey !== undefined ? t(f.valueKey) : f.value}
          />
        ))}
      </dl>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  // a fact with an empty value is a LABEL that is itself the fact ("Entered", "Left") — printing a
  // dash beside it would read as missing data
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1 last:border-b-0" style={{ borderColor: 'var(--admin-hairline)' }}>
      <dt className="shrink-0 text-[11px] uppercase tracking-wider" style={{ color: 'var(--admin-ink-soft)' }}>{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm" style={{ color: 'var(--admin-ink)' }}>{value}</dd>
    </div>
  )
}
