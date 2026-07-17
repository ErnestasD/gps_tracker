import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PlaybackMap } from '@/components/PlaybackMap'
import { Badge, PageHeader } from '@/components/admin/AdminKit'
import { listDevices } from '@/lib/devices'
import { listDrivers } from '@/lib/drivers'
import { defaultRange, listPositions } from '@/lib/playback'
import { assignTripDriver, fmtDuration, fmtKm, listTrips, tripDurationMs } from '@/lib/trips'
import type { TripView } from '@orbetra/shared'

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })

const fieldStyle: React.CSSProperties = {
  borderColor: 'var(--admin-hairline)',
  background: 'var(--admin-surface)',
  color: 'var(--admin-ink)',
}

const th = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider'
const thStyle: React.CSSProperties = { color: 'var(--admin-ink-soft)', background: 'var(--admin-surface-sunken)' }

/** Trips list + detail (E04-4): filter trips, pick one to see its route + stats.
 * Admin re-skin (ADR-028): PageHeader carries the filters; list/detail are admin-cards. */
export function TripsPage() {
  const { t } = useTranslation()
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const [deviceId, setDeviceId] = useState('')
  const [range, setRange] = useState(() => defaultRange(Date.now()))
  const [selected, setSelected] = useState<TripView | null>(null)
  const qc = useQueryClient()
  const drivers = useQuery({ queryKey: ['drivers'], queryFn: listDrivers })

  const assign = async (tripId: string, driverId: string | null) => {
    const updated = await assignTripDriver(tripId, driverId).catch(() => null)
    if (updated === null) return
    setSelected((s) => (s?.id === tripId ? updated : s)) // reflect the new driver in the open detail
    void qc.invalidateQueries({ queryKey: ['trips'] }) // refresh the table's driver column
  }

  const trips = useQuery({
    queryKey: ['trips', deviceId, range.from, range.to],
    // a cleared datetime-local is '' → skip that bound rather than throw on new Date('')
    queryFn: () => listTrips({ ...(deviceId ? { deviceId } : {}), ...isoOpt('from', range.from), ...isoOpt('to', range.to), limit: 500 }),
  })

  // the selected trip's route = positions within its window
  const route = useQuery({
    queryKey: ['tripRoute', selected?.id],
    queryFn: () => listPositions(selected!.deviceId, { from: iso2(selected!.startTime), to: iso2(selected!.endTime ?? new Date().toISOString()), limit: 10_000 }),
    enabled: selected !== null,
  })

  const rows = useMemo(() => trips.data ?? [], [trips.data])

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
      <PageHeader className="mb-0" title={t('trips.title')} description={t('trips.desc')}>
        <FilterLabel label={t('trips.device')}>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} data-testid="trips-device" className="h-9 rounded-md border px-2 text-sm" style={fieldStyle}>
            <option value="">{t('trips.allDevices')}</option>
            {(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FilterLabel>
        <FilterLabel label={t('trips.from')}>
          <input type="datetime-local" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} data-testid="trips-from" className="h-9 rounded-md border px-2 text-sm" style={fieldStyle} />
        </FilterLabel>
        <FilterLabel label={t('trips.to')}>
          <input type="datetime-local" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} data-testid="trips-to" className="h-9 rounded-md border px-2 text-sm" style={fieldStyle} />
        </FilterLabel>
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* list */}
        <div className="admin-card min-h-0 overflow-hidden">
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
                    <th className={th} style={thStyle}>{t('trips.start')}</th>
                    <th className={th} style={thStyle}>{t('trips.duration')}</th>
                    <th className={th} style={thStyle}>{t('trips.distance')}</th>
                    <th className={th} style={thStyle}>{t('trips.maxSpeed')}</th>
                    <th className={th} style={thStyle}>{t('trips.driver')}</th>
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
                        {fmt.format(new Date(tr.startTime))}
                        {tr.status === 'open' && <Badge tone="warning" className="ml-2">{t('trips.ongoing')}</Badge>}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{fmtDuration(tripDurationMs(tr, Date.now()))}</td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink)' }}>
                        {fmtKm(tr.distanceM)}
                        <span className="ml-1 text-[10px] uppercase" style={{ color: 'var(--admin-ink-soft)' }}>{tr.distanceSource === 'odometer' ? t('trips.odo') : t('trips.gps')}</span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>{tr.maxSpeed} km/h</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--admin-ink-soft)' }} data-testid={`trip-driver-${tr.id}`}>{tr.driverName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* detail */}
        <div className="admin-card min-h-0 overflow-hidden">
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
                  <select
                    value={selected.driverId ?? ''}
                    data-testid="trip-driver-select"
                    onChange={(e) => void assign(selected.id, e.target.value === '' ? null : e.target.value)}
                    className="h-8 flex-1 rounded-md border px-2 text-sm"
                    style={fieldStyle}
                  >
                    <option value="">{t('trips.noDriver')}</option>
                    {(drivers.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
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

/** A datetime-local filter bound → a { from|to: ISO } fragment, or {} if empty/invalid
 * (a cleared input is '' and must not throw on new Date('')). */
function isoOpt(key: 'from' | 'to', v: string): { from?: string } | { to?: string } {
  if (v === '') return {}
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? {} : { [key]: d.toISOString() }
}
