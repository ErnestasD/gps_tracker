import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PlaybackMap } from '@/components/PlaybackMap'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { listDevices } from '@/lib/devices'
import { defaultRange, listPositions } from '@/lib/playback'
import { fmtDuration, fmtKm, listTrips, tripDurationMs } from '@/lib/trips'
import type { TripView } from '@orbetra/shared'

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })

/** Trips list + detail (E04-4): filter trips, pick one to see its route + stats. */
export function TripsPage() {
  const { t } = useTranslation()
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const [deviceId, setDeviceId] = useState('')
  const [range, setRange] = useState(() => defaultRange(Date.now()))
  const [selected, setSelected] = useState<TripView | null>(null)

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
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-lg font-semibold">{t('trips.title')}</h1>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('trips.device')}
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} data-testid="trips-device" className="h-9 rounded-card border border-line bg-surface px-2 text-sm">
            <option value="">{t('trips.allDevices')}</option>
            {(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('trips.from')}
          <input type="datetime-local" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} data-testid="trips-from" className="h-9 rounded-card border border-line bg-surface px-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('trips.to')}
          <input type="datetime-local" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} data-testid="trips-to" className="h-9 rounded-card border border-line bg-surface px-2 text-sm" />
        </label>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        {/* list */}
        <Card className="min-h-0 overflow-hidden">
          <CardContent className="h-full overflow-auto p-0">
            {trips.isError ? (
              <p role="alert" className="py-10 text-center text-sm text-danger" data-testid="trips-error">{t('trips.error')}</p>
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted" data-testid="trips-empty">
                {trips.isFetching ? t('trips.loading') : t('trips.empty')}
              </p>
            ) : (
              <table className="w-full text-sm" data-testid="trips-table">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="p-2 font-medium">{t('trips.start')}</th>
                    <th className="p-2 font-medium">{t('trips.duration')}</th>
                    <th className="p-2 font-medium">{t('trips.distance')}</th>
                    <th className="p-2 font-medium">{t('trips.maxSpeed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((tr) => (
                    <tr
                      key={tr.id}
                      data-testid={`trip-row-${tr.id}`}
                      onClick={() => setSelected(tr)}
                      className={`cursor-pointer border-b border-line/60 hover:bg-surface-2 ${selected?.id === tr.id ? 'bg-surface-2' : ''}`}
                    >
                      <td className="p-2 tabular-nums">
                        {fmt.format(new Date(tr.startTime))}
                        {tr.status === 'open' && <Badge variant="warn" className="ml-2">{t('trips.ongoing')}</Badge>}
                      </td>
                      <td className="p-2 tabular-nums text-muted">{fmtDuration(tripDurationMs(tr, Date.now()))}</td>
                      <td className="p-2 tabular-nums">
                        {fmtKm(tr.distanceM)}
                        <span className="ml-1 text-[10px] uppercase text-muted">{tr.distanceSource === 'odometer' ? t('trips.odo') : t('trips.gps')}</span>
                      </td>
                      <td className="p-2 tabular-nums text-muted">{tr.maxSpeed} km/h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* detail */}
        <Card className="min-h-0 overflow-hidden">
          <CardContent className="flex h-full flex-col gap-2 p-2">
            {selected === null ? (
              <p className="m-auto text-sm text-muted" data-testid="trip-detail-empty">{t('trips.pick')}</p>
            ) : (
              <>
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-card border border-line" data-testid="trip-detail">
                  <PlaybackMap positions={route.data ?? []} trips={[selected]} index={-1} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <Stat label={t('trips.duration')} value={fmtDuration(tripDurationMs(selected, Date.now()))} />
                  <Stat label={t('trips.distance')} value={fmtKm(selected.distanceM)} />
                  <Stat label={t('trips.maxSpeed')} value={`${selected.maxSpeed} km/h`} />
                  <Stat label={t('trips.idle')} value={fmtDuration(selected.idleS * 1000)} />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-surface-2 p-2">
      <div className="text-[10px] uppercase text-muted">{label}</div>
      <div className="tabular-nums font-medium">{value}</div>
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
