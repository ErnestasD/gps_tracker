import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PlaybackMap } from '@/components/PlaybackMap'
import { Badge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { DatePicker } from '@/components/admin/DatePicker'
import { useFmt } from '@/lib/datetime'
import { listDevices } from '@/lib/devices'
import { listDrivers } from '@/lib/drivers'
import { dayEndIso, dayStartIso, defaultDayRange, listPositions } from '@/lib/playback'
import { assignTripDriver, fmtDuration, fmtKm, listTrips, tripAvgSpeedKmh, tripDurationMs } from '@/lib/trips'
import type { TripView } from '@orbetra/shared'

const th = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)', background: 'var(--admin-surface-sunken)' }

/** Sortable columns (Lovable app.trips idiom): start/device/distance/avg/max toggle a single
 * page-local sort — the markup stays a hand-rolled table because row selection drives the
 * detail map (DataTable has no row-click API). Mobile keeps the table (secondary columns
 * hidden via md:table-cell) instead of DataTable's stacked cards: card rows would lose the
 * row-click → detail-map affordance that is this page's whole point. */
type SortKey = 'start' | 'device' | 'distance' | 'avg' | 'max'

/** Trips list + detail (E04-4): filter trips, pick one to see its route + stats.
 * Admin re-skin (ADR-028): PageHeader carries the filters (device Combobox + DatePicker
 * day range per the round-2 amendment); list/detail are admin-cards. */
export function TripsPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const [deviceId, setDeviceId] = useState('')
  const [range, setRange] = useState(() => defaultDayRange(Date.now()))
  const [driverQ, setDriverQ] = useState('') // client-side driver filter (reference searchKeys)
  const [selected, setSelected] = useState<TripView | null>(null)
  const qc = useQueryClient()
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers })

  const assign = async (tripId: string, driverId: string | null) => {
    const updated = await assignTripDriver(tripId, driverId).catch(() => null)
    if (updated === null) return
    setSelected((s) => (s?.id === tripId ? updated : s)) // reflect the new driver in the open detail
    void qc.invalidateQueries({ queryKey: ['trips'] }) // refresh the table's driver column
  }

  // date-only pickers → full-local-day ISO bounds (stable query-key form)
  const fromIso = dayStartIso(range.from)
  const toIso = dayEndIso(range.to)
  const trips = useQuery({
    queryKey: ['trips', deviceId, fromIso, toIso],
    queryFn: () => listTrips({ ...(deviceId ? { deviceId } : {}), from: fromIso, to: toIso, limit: 500 }),
  })

  // the selected trip's route = positions within its window
  const route = useQuery({
    queryKey: ['tripRoute', selected?.id],
    queryFn: () => listPositions(selected!.deviceId, { from: iso2(selected!.startTime), to: iso2(selected!.endTime ?? new Date().toISOString()), limit: 10_000 }),
    enabled: selected !== null,
  })

  const deviceLabel = (id: string): string => (devices.data ?? []).find((d) => d.id === id)?.name ?? id

  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'start', dir: 'desc' })
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const rows = useMemo(() => {
    const now = Date.now()
    const ql = driverQ.trim().toLowerCase()
    const list = (trips.data ?? []).filter((tr) => ql === '' || (tr.driverName ?? '').toLowerCase().includes(ql))
    const val = (tr: TripView): number | string => {
      switch (sort.key) {
        case 'start': return Date.parse(tr.startTime)
        case 'device': return deviceLabel(tr.deviceId).toLowerCase()
        case 'distance': return tr.distanceM
        case 'avg': return tripAvgSpeedKmh(tr, now)
        case 'max': return tr.maxSpeed
      }
    }
    return [...list].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [trips.data, sort, driverQ, devices.data]) // devices.data: deviceLabel input for 'device' sort

  const sortTh = (key: SortKey, label: string, opts: { align?: 'right'; hide?: boolean } = {}) => (
    <th
      className={`${th} ${opts.hide === true ? 'hidden md:table-cell' : ''} ${opts.align === 'right' ? 'text-right' : ''}`}
      style={thStyle}
      aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-[var(--admin-ink)]"
        data-testid={`trips-sort-${key}`}
      >
        {label}
        {sort.key === key ? (
          sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />
        )}
      </button>
    </th>
  )

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('trips.title')} description={t('trips.desc')}>
        <FilterLabel label={t('trips.device')}>
          <div className="w-44">
            <Combobox
              value={deviceId}
              onChange={setDeviceId}
              options={[
                { value: '', label: t('trips.allDevices') },
                ...(devices.data ?? []).map((d) => ({ value: d.id, label: d.name, ...(d.plate !== null && d.plate !== '' ? { hint: d.plate } : {}) })),
              ]}
              aria-label={t('trips.device')}
              data-testid="trips-device"
            />
          </div>
        </FilterLabel>
        <FilterLabel label={t('trips.driver')}>
          {/* driver search (reference searchKeys) — a plain client filter over the loaded rows */}
          <div className="flex h-9 w-44 items-center gap-2 rounded-md border px-3 text-sm" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }}>
            <Search className="h-3.5 w-3.5 opacity-60" aria-hidden />
            <input
              value={driverQ}
              onChange={(e) => setDriverQ(e.target.value)}
              placeholder={t('trips.searchDriver')}
              aria-label={t('trips.driver')}
              data-testid="trips-driver-search"
              className="w-full bg-transparent outline-none placeholder:opacity-60"
              style={{ color: 'var(--admin-ink)' }}
            />
          </div>
        </FilterLabel>
        {/* unselecting a day is ignored — the range stays fully bounded */}
        <FilterLabel label={t('trips.from')}>
          <div className="w-40"><DatePicker value={range.from} onChange={(d) => d && setRange((r) => ({ ...r, from: d }))} aria-label={t('trips.from')} data-testid="trips-from" /></div>
        </FilterLabel>
        <FilterLabel label={t('trips.to')}>
          <div className="w-40"><DatePicker value={range.to} onChange={(d) => d && setRange((r) => ({ ...r, to: d }))} aria-label={t('trips.to')} data-testid="trips-to" /></div>
        </FilterLabel>
      </PageHeader>

      {/* Lovable two-panel proportions: the list carries the wide columns, the detail map keeps 2/5 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-5">
        {/* list */}
        <div className="admin-card min-h-0 overflow-hidden lg:col-span-3">
          <div className="h-full overflow-auto">
            {trips.isError ? (
              <p role="alert" className="py-10 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="trips-error">{t('trips.error')}</p>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="trips-empty">
                {trips.isFetching ? t('trips.loading') : t('trips.empty')}
              </p>
            ) : (
              <table className="w-full text-sm" data-testid="trips-table">
                <thead className="sticky top-0">
                  <tr>
                    {sortTh('start', t('trips.start'))}
                    {sortTh('device', t('trips.device'), { hide: true })}
                    <th className={th} style={thStyle}>{t('trips.driver')}</th>
                    {sortTh('distance', t('trips.distance'), { align: 'right' })}
                    {sortTh('avg', t('trips.avgSpeed'), { align: 'right', hide: true })}
                    {sortTh('max', t('trips.maxSpeed'), { align: 'right', hide: true })}
                    <th className={`${th} hidden text-right md:table-cell`} style={thStyle}>{t('trips.duration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((tr) => (
                    <tr
                      key={tr.id}
                      data-testid={`trip-row-${tr.id}`}
                      onClick={() => setSelected(tr)}
                      // keyboard access: rows are the only way to open the detail pane (a11y MED)
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelected(tr)
                        }
                      }}
                      aria-selected={selected?.id === tr.id}
                      className="admin-hairline-b cursor-pointer transition-colors hover:bg-[var(--admin-surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]"
                      style={selected?.id === tr.id ? { background: 'var(--admin-surface-sunken)' } : undefined}
                    >
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink)' }}>
                        {dt(tr.startTime)}
                        {tr.status === 'open' && <Badge tone="warning" className="ml-2">{t('trips.ongoing')}</Badge>}
                      </td>
                      <td className="hidden px-3 py-2.5 font-medium md:table-cell" style={{ color: 'var(--admin-ink)' }}>{deviceLabel(tr.deviceId)}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--admin-ink-soft)' }} data-testid={`trip-driver-${tr.id}`}>{tr.driverName ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--admin-ink)' }}>
                        {fmtKm(tr.distanceM)}
                        <span className="ml-1 text-[10px] uppercase" style={{ color: 'var(--admin-ink-soft)' }}>{tr.distanceSource === 'odometer' ? t('trips.odo') : t('trips.gps')}</span>
                      </td>
                      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell" style={{ color: 'var(--admin-ink-soft)' }}>{tripAvgSpeedKmh(tr, Date.now())} {t('units.kmh')}</td>
                      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell" style={{ color: 'var(--admin-ink-soft)' }}>{tr.maxSpeed} {t('units.kmh')}</td>
                      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell" style={{ color: 'var(--admin-ink-soft)' }}>{fmtDuration(tripDurationMs(tr, Date.now()))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* detail */}
        <div className="admin-card min-h-0 overflow-hidden lg:col-span-2">
          <div className="flex h-full flex-col gap-2 p-2">
            {selected === null ? (
              <p className="m-auto text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="trip-detail-empty">{t('trips.pick')}</p>
            ) : (
              <>
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border" style={{ borderColor: 'var(--admin-hairline)' }} data-testid="trip-detail">
                  <PlaybackMap positions={route.data ?? []} trips={[selected]} index={-1} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <Stat label={t('trips.duration')} value={fmtDuration(tripDurationMs(selected, Date.now()))} />
                  <Stat label={t('trips.distance')} value={fmtKm(selected.distanceM)} />
                  <Stat label={t('trips.maxSpeed')} value={`${selected.maxSpeed} km/h`} />
                  <Stat label={t('trips.idle')} value={fmtDuration(selected.idleS * 1000)} />
                </div>
                <label className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--admin-ink-soft)' }}>
                  {t('trips.driver')}:
                  <div className="flex-1">
                    <Combobox
                      value={selected.driverId ?? ''}
                      onChange={(v) => void assign(selected.id, v === '' ? null : v)}
                      options={[{ value: '', label: t('trips.noDriver') }, ...(drivers.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
                      aria-label={t('trips.driver')}
                      data-testid="trip-driver-select"
                    />
                  </div>
                </label>
              </>
            )}
          </div>
        </div>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface-sunken)' }}>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--admin-ink-soft)' }}>{label}</div>
      <div className="tabular-nums font-medium" style={{ color: 'var(--admin-ink)' }}>{value}</div>
    </div>
  )
}

/** datetime — the trip times are already ISO; guard against a bad parse. */
const iso2 = (s: string): string => {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}
