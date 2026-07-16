import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { FuelChart } from '@/components/FuelChart'
import { PlaybackMap } from '@/components/PlaybackMap'
import { SpeedChart } from '@/components/SpeedChart'
import { AdminButton, PageHeader } from '@/components/admin/AdminKit'
import { listDevices } from '@/lib/devices'
import { fuelSeries, listFuel } from '@/lib/fuel'
import { defaultRange, listDeviceTrips, listPositions } from '@/lib/playback'

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' })
const km = (m: number) => (m / 1000).toFixed(1)

const selectCls = 'h-9 rounded-md border px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--admin-brand)]/30'
const selectStyle: CSSProperties = { borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }
const fieldCls = 'flex flex-col gap-1 text-xs'
const fieldStyle: CSSProperties = { color: 'var(--admin-ink-soft)' }

/** History playback (E04-3): pick a device + range, replay its trail with a speed
 * chart + scrub, trip stop markers. */
export function PlaybackPage() {
  const { t } = useTranslation()
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const [deviceId, setDeviceId] = useState('')
  const [range, setRange] = useState(() => defaultRange(Date.now()))
  const [index, setIndex] = useState(0)

  // pick the first device once loaded
  useEffect(() => {
    if (deviceId === '' && devices.data && devices.data.length > 0) setDeviceId(devices.data[0]!.id)
  }, [devices.data, deviceId])

  const iso = (v: string) => new Date(v).toISOString()
  const positions = useQuery({
    queryKey: ['positions', deviceId, range.from, range.to],
    queryFn: () => listPositions(deviceId, { from: iso(range.from), to: iso(range.to), limit: 10_000 }),
    enabled: deviceId !== '',
  })
  const trips = useQuery({
    queryKey: ['deviceTrips', deviceId, range.from, range.to],
    queryFn: () => listDeviceTrips(deviceId, { from: iso(range.from), to: iso(range.to) }),
    enabled: deviceId !== '',
  })
  const fuel = useQuery({
    queryKey: ['fuel', deviceId, range.from, range.to],
    queryFn: () => listFuel(deviceId, { from: iso(range.from), to: iso(range.to) }),
    enabled: deviceId !== '',
  })

  const pts = useMemo(() => positions.data ?? [], [positions.data])
  const speeds = useMemo(() => pts.map((p) => p.speed ?? 0), [pts])
  const fuelData = useMemo(() => fuelSeries(fuel.data ?? []), [fuel.data])
  useEffect(() => setIndex(0), [pts])

  const current = pts[Math.min(index, pts.length - 1)]

  return (
    <div className="flex h-full flex-col gap-3 p-4 md:p-6">
      <PageHeader title={t('playback.title')} description={t('playback.desc')} className="mb-0">
        <label className={fieldCls} style={fieldStyle}>
          {t('playback.device')}
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} data-testid="playback-device" className={selectCls} style={selectStyle}>
            {(devices.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className={fieldCls} style={fieldStyle}>
          {t('playback.from')}
          <input type="datetime-local" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} data-testid="playback-from" className={selectCls} style={selectStyle} />
        </label>
        <label className={fieldCls} style={fieldStyle}>
          {t('playback.to')}
          <input type="datetime-local" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} data-testid="playback-to" className={selectCls} style={selectStyle} />
        </label>
      </PageHeader>

      {/* map card */}
      <div className="admin-card relative min-h-0 flex-1 overflow-hidden">
        <PlaybackMap positions={pts} trips={trips.data ?? []} index={index} />
      </div>

      {/* scrubber + charts card */}
      <div className="admin-card space-y-2 p-3 md:p-4">
        {pts.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="playback-empty">
            {positions.isFetching ? t('playback.loading') : t('playback.empty')}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--admin-ink)' }}>
              <span style={{ color: 'var(--admin-ink-soft)' }}>{t('playback.samples', { n: pts.length })}</span>
              {current && (
                <span data-testid="playback-current" className="tabular-nums">
                  {fmt.format(new Date(current.fixTime))} · {current.speed ?? 0} km/h
                </span>
              )}
              <span className="ml-auto flex gap-3 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                {(trips.data ?? []).length > 0 && <span>{t('playback.trips', { n: (trips.data ?? []).length })}</span>}
                {(trips.data ?? []).length > 0 && <span>{t('playback.distance', { km: km((trips.data ?? []).reduce((s, tr) => s + tr.distanceM, 0)) })}</span>}
              </span>
            </div>
            <SpeedChart speeds={speeds} index={index} onScrub={setIndex} />
            {/* AVL-gated (§4): only devices actually reporting fuel get the graph */}
            {fuelData.points.length > 0 && <FuelChart points={fuelData.points} unit={fuelData.unit} />}
            <div className="flex items-center gap-2">
              <AdminButton variant="secondary" size="sm" onClick={() => setIndex(0)} data-testid="playback-start">⏮</AdminButton>
              <input
                type="range" min={0} max={Math.max(0, pts.length - 1)} value={index}
                onChange={(e) => setIndex(Number(e.target.value))}
                data-testid="playback-scrub" className="flex-1 accent-[var(--admin-brand)]"
              />
              <AdminButton variant="secondary" size="sm" onClick={() => setIndex(pts.length - 1)} data-testid="playback-end">⏭</AdminButton>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
