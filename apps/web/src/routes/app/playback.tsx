import { useQuery } from '@tanstack/react-query'
import { Fuel, Gauge, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FuelChart } from '@/components/FuelChart'
import { PlaybackMap } from '@/components/PlaybackMap'
import { SpeedChart } from '@/components/SpeedChart'
import { AdminButton, Badge, PageHeader } from '@/components/admin/AdminKit'
import { Combobox } from '@/components/admin/Combobox'
import { DatePicker } from '@/components/admin/DatePicker'
import { useFmt } from '@/lib/datetime'
import { listDevices } from '@/lib/devices'
import { fuelAtTime, fuelSeries, listFuel } from '@/lib/fuel'
import { dayEndIso, dayStartIso, defaultDayRange, listDeviceTrips, listPositions } from '@/lib/playback'

const km = (m: number) => (m / 1000).toFixed(1)

/** History playback (E04-3), rebuilt on the orbetra_design_new app.history layout (ADR-028
 * round 2): device Combobox + DatePicker range in the PageHeader (date-only per the reference —
 * a picked day queries its full local day); one big admin-card with the map (floating
 * current-position overlay), transport controls (skip/play/pause, ~5 pos/s), point counter and a
 * full-width scrubber; speed + fuel chart cards side by side below. Queries and the invalid-fix /
 * AVL-gating rules are unchanged. */
export function PlaybackPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const [deviceId, setDeviceId] = useState('')
  const [range, setRange] = useState(() => defaultDayRange(Date.now()))
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)

  // pick the first device once loaded
  useEffect(() => {
    if (deviceId === '' && devices.data && devices.data.length > 0) setDeviceId(devices.data[0]!.id)
  }, [devices.data, deviceId])

  // date-only pickers → full-local-day ISO bounds (also the stable query-key form)
  const fromIso = dayStartIso(range.from)
  const toIso = dayEndIso(range.to)
  const positions = useQuery({
    queryKey: ['positions', deviceId, fromIso, toIso],
    queryFn: () => listPositions(deviceId, { from: fromIso, to: toIso, limit: 10_000 }),
    enabled: deviceId !== '',
  })
  const trips = useQuery({
    queryKey: ['deviceTrips', deviceId, fromIso, toIso],
    queryFn: () => listDeviceTrips(deviceId, { from: fromIso, to: toIso }),
    enabled: deviceId !== '',
  })
  const fuel = useQuery({
    queryKey: ['fuel', deviceId, fromIso, toIso],
    queryFn: () => listFuel(deviceId, { from: fromIso, to: toIso }),
    enabled: deviceId !== '',
  })

  const pts = useMemo(() => positions.data ?? [], [positions.data])
  const speeds = useMemo(() => pts.map((p) => p.speed ?? 0), [pts])
  const fuelData = useMemo(() => fuelSeries(fuel.data ?? []), [fuel.data])
  useEffect(() => {
    setIndex(0)
    setPlaying(false)
  }, [pts])

  // "Groti": advance the scrub index ~5 positions/s; reaching the last point stops
  useEffect(() => {
    if (!playing) return
    const iv = setInterval(() => setIndex((i) => (i >= pts.length - 1 ? i : i + 1)), 200)
    return () => clearInterval(iv)
  }, [playing, pts.length])
  useEffect(() => {
    if (playing && (pts.length === 0 || index >= pts.length - 1)) setPlaying(false)
  }, [playing, index, pts.length])

  const current = pts[Math.min(index, pts.length - 1)]
  const device = (devices.data ?? []).find((d) => d.id === deviceId)
  const fuelNow = current !== undefined ? fuelAtTime(fuelData.points, Date.parse(current.fixTime)) : null
  const tripList = trips.data ?? []

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader title={t('playback.title')} description={t('playback.desc')}>
        <div className="w-56">
          <Combobox
            value={deviceId}
            onChange={setDeviceId}
            // plate as the option hint (Lovable app.history idiom) — searchable alongside the name
            options={(devices.data ?? []).map((d) => ({ value: d.id, label: d.name, ...(d.plate !== null && d.plate !== '' ? { hint: d.plate } : {}) }))}
            aria-label={t('playback.device')}
            data-testid="playback-device"
          />
        </div>
        {/* unselecting a day (undefined) is ignored — the range always stays fully bounded */}
        <div className="w-40">
          <DatePicker value={range.from} onChange={(d) => d && setRange((r) => ({ ...r, from: d }))} aria-label={t('playback.from')} data-testid="playback-from" />
        </div>
        <div className="w-40">
          <DatePicker value={range.to} onChange={(d) => d && setRange((r) => ({ ...r, to: d }))} aria-label={t('playback.to')} data-testid="playback-to" />
        </div>
      </PageHeader>

      <div className="admin-card overflow-hidden">
        {/* map + floating current-position overlay */}
        <div className="relative h-[360px] md:h-[420px]">
          <PlaybackMap positions={pts} trips={tripList} index={index} />
          {current !== undefined && device !== undefined && (
            <div className="admin-card absolute left-3 top-3 z-10 px-3 py-2" data-testid="playback-overlay">
              <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                {device.name} · {dt(current.fixTime)}
              </div>
              <div className="mt-1 flex items-center gap-3 text-sm" style={{ color: 'var(--admin-ink)' }}>
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Gauge className="h-3.5 w-3.5" style={{ color: 'var(--admin-brand)' }} aria-hidden />
                  {current.speed ?? 0} {t('units.kmh')}
                </span>
                {fuelNow !== null && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Fuel className="h-3.5 w-3.5" style={{ color: 'var(--admin-brand)' }} aria-hidden />
                    {fuelData.unit === 'pct' ? `${fuelNow}%` : t('playback.fuelLiters', { l: fuelNow.toFixed(1) })}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* transport controls + scrubber */}
        <div className="admin-hairline-t p-4">
          {pts.length === 0 ? (
            <p className="py-6 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="playback-empty">
              {positions.isFetching ? t('playback.loading') : t('playback.empty')}
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1">
                  <AdminButton
                    variant="ghost"
                    size="sm"
                    aria-label={t('playback.skipStart')}
                    data-testid="playback-start"
                    onClick={() => {
                      setPlaying(false)
                      setIndex(0)
                    }}
                  >
                    <SkipBack className="h-4 w-4" aria-hidden />
                  </AdminButton>
                  <AdminButton
                    size="sm"
                    data-testid="playback-play"
                    onClick={() => {
                      // Play at the last point restarts from the top — otherwise the auto-stop
                      // effect below immediately clears `playing` and the button is inert
                      if (!playing && pts.length > 0 && index >= pts.length - 1) setIndex(0)
                      setPlaying((p) => !p)
                    }}
                  >
                    {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                    {playing ? t('playback.pause') : t('playback.play')}
                  </AdminButton>
                  <AdminButton
                    variant="ghost"
                    size="sm"
                    aria-label={t('playback.skipEnd')}
                    data-testid="playback-end"
                    onClick={() => {
                      setPlaying(false)
                      setIndex(pts.length - 1)
                    }}
                  >
                    <SkipForward className="h-4 w-4" aria-hidden />
                  </AdminButton>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums" style={{ color: 'var(--admin-ink-soft)' }}>
                  <span data-testid="playback-current">{t('playback.point', { i: Math.min(index, pts.length - 1) + 1, n: pts.length })}</span>
                  {tripList.length > 0 && <span>{t('playback.trips', { n: tripList.length })}</span>}
                  {tripList.length > 0 && <span>{t('playback.distance', { km: km(tripList.reduce((s, tr) => s + tr.distanceM, 0)) })}</span>}
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, pts.length - 1)}
                value={index}
                onChange={(e) => setIndex(Number(e.target.value))}
                aria-label={t('playback.scrub')}
                data-testid="playback-scrub"
                className="w-full accent-[var(--admin-brand)]"
              />
            </>
          )}
        </div>
      </div>

      {/* chart cards: speed always (when history exists), fuel AVL-gated (§4) */}
      {pts.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="admin-card p-3 md:p-4">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span style={{ color: 'var(--admin-ink-soft)' }}>{t('playback.speed')}</span>
              <Badge tone="brand">
                <span className="tabular-nums">
                  {current?.speed ?? 0} {t('units.kmh')}
                </span>
              </Badge>
            </div>
            <SpeedChart speeds={speeds} index={index} onScrub={setIndex} />
          </div>
          {fuelData.points.length > 0 && (
            <div className="admin-card p-3 md:p-4">
              {/* mirror SpeedChart: scrub cursor + at-position value (fuelNow = fuelAtTime) */}
              <FuelChart
                points={fuelData.points}
                unit={fuelData.unit}
                {...(current !== undefined ? { cursorMs: Date.parse(current.fixTime) } : {})}
                value={fuelNow}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
