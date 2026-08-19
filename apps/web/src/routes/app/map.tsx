import { useQuery } from '@tanstack/react-query'
import { Bell, Layers, Maximize2, Minimize2, PanelLeft, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { DeviceList } from '@/components/DeviceList'
import { Inspector } from '@/components/Inspector'
import { Timeline } from '@/components/Timeline'
import { LiveMap } from '@/components/LiveMap'
import { Badge } from '@/components/admin/AdminKit'
import { getLastPositions, getWsTicket, wsUrl, ApiError } from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { useFmt } from '@/lib/datetime'
import { listDevices } from '@/lib/devices'
import { listDrivers } from '@/lib/drivers'
import { listEvents } from '@/lib/events'
import { fleetPanelCounts, type FleetFilter } from '@/lib/fleetFilter'
import { geofenceFeatures, listGeofences } from '@/lib/geofences'
import { buildTrailFeatures, liveStore } from '@/lib/liveStore'
import { DEFAULT_LAYERS, loadLayers, saveLayers, type MapLayers } from '@/lib/mapLayers'
import { getTrack } from '@/lib/telemetry'
import { cn } from '@/lib/utils'
import { LiveSocket } from '@/lib/ws'
import { router } from '@/router'

// Module singletons, NOT effect-scoped: StrictMode double-mounts would burn two
// single-use tickets and kill the first socket (plan risk #1).
const socket = new LiveSocket({
  getTicket: getWsTicket,
  buildUrl: wsUrl,
  onMessage: (data) => liveStore.ingestRaw(data),
  onStatus: (s) => liveStore.setConnection(s),
  isAuthError: (err) => err instanceof ApiError && err.status === 401,
  onAuthError: () => void router.navigate({ to: '/login' }),
})

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export function MapPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const snap = useSyncExternalStore(liveStore.subscribe, liveStore.getSnapshot)
  // the device registry is the authoritative bound (E03-3): reconcile the live set to it so a
  // device retired/removed here or in another tab drops off the map instead of decaying to
  // 'offline' for the rest of the session (liveStore.byId never evicted on its own)
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  // the driver roster, so a row can say who is in the vehicle rather than only what it is called
  const driversQ = useQuery({ queryKey: ['drivers'], queryFn: listDrivers })
  const geofencesQ = useQuery({ queryKey: ['geofences'], queryFn: listGeofences })
  // the account's latest events — the ticker beside the map, and the answer to "what just happened"
  const eventsQ = useQuery({ queryKey: ['events', 'feed'], queryFn: () => listEvents({ limit: 8 }), refetchInterval: 60_000 })
  const [listOpen, setListOpen] = useState(true)
  const [full, setFull] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [layers, setLayers] = useState<MapLayers>(() => loadLayers())
  const [filter, setFilter] = useState<FleetFilter>('all')
  /** Pausing stops the STORE, not the socket: the feed keeps arriving and the map simply stops
   *  redrawing, so resuming shows the present rather than replaying a backlog. */
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    saveLayers(layers)
  }, [layers])

  useEffect(() => {
    if (devices.data === undefined) return
    liveStore.retain(devices.data.filter((d) => d.retiredAt === null).map((d) => d.id))
  }, [devices.data])

  useEffect(() => {
    if (paused) liveStore.stop()
    else liveStore.start()
  }, [paused])

  useEffect(() => {
    liveStore.start()
    socket.start()
    // late snapshot refresh covers reload-straight-to-/app/map (login seeds it too;
    // max-wins makes the overlap harmless)
    getLastPositions()
      .then((events) => liveStore.seed(events))
      .catch(() => undefined) // WS still delivers; snapshot is best-effort
    return () => {
      socket.stop()
      liveStore.stop()
    }
  }, [])

  // deviceId → label from the CRUD registry: the name, plus the plate in parens when set, e.g.
  // "Kaunas Truck 12 (LTV 177)". Shows names not raw ids; search matches name OR plate.
  const nameOf = useMemo(() => {
    const m = new Map((devices.data ?? []).map((d) => [d.id, d.plate ? `${d.name} (${d.plate})` : d.name]))
    return (id: string) => m.get(id) ?? id
  }, [devices.data])

  /** Plate and driver as the fleet recorded them — the two things a dispatcher searches by. */
  const detailOf = useMemo(() => {
    const drivers = new Map((driversQ.data ?? []).map((d) => [d.id, d.name]))
    const m = new Map(
      (devices.data ?? []).map((d) => [
        d.id,
        { plate: d.plate, driver: d.driverId !== null ? (drivers.get(d.driverId) ?? null) : null },
      ]),
    )
    return (id: string) => m.get(id)
  }, [devices.data, driversQ.data])

  const selected = snap.selectedId !== null ? snap.devices.find((d) => d.ev.deviceId === snap.selectedId) : undefined
  // The CRUD row behind the selected marker. Absent for a device streaming positions we have no
  // registry record for — it can still be watched, but not commanded, and the inspector says so by
  // offering only the overview.
  const registryRow = useMemo(
    () => (devices.data ?? []).find((d) => d.id === snap.selectedId && d.retiredAt === null),
    [devices.data, snap.selectedId],
  )
  // device writes require account_manager+ (WRITE_POLICY.device), same rule as the devices table
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')

  // Active devices the live set has never heard from. The registry list is already fetched above
  // (it bounds the live set); the panel used to ignore it, so a fleet of eight read "3 of 3" and
  // the five that had never called in were simply absent — indistinguishable from not existing.
  const silent = useMemo(() => {
    const live = new Set(snap.devices.map((d) => d.ev.deviceId))
    return (devices.data ?? [])
      .filter((d) => d.retiredAt === null && !live.has(d.id))
      .map((d) => ({ id: d.id, name: d.name }))
  }, [devices.data, snap.devices])

  const counts = useMemo(() => fleetPanelCounts(snap.devices, silent), [snap.devices, silent])

  // ── the selected vehicle's 24 hours ──────────────────────────────────────
  // One query, two consumers: the scrubber reads the points, the map draws the line. Fetching it
  // twice would double the load for a window that can hold thousands of rows.
  const track = useQuery({
    queryKey: ['track', snap.selectedId],
    queryFn: () => getTrack(snap.selectedId as string, 24),
    enabled: snap.selectedId !== null,
  })
  const trackPoints = useMemo(() => track.data?.points ?? [], [track.data])
  const history = useMemo<GeoJSON.FeatureCollection>(
    () =>
      snap.selectedId === null
        ? EMPTY_FC
        : {
            type: 'FeatureCollection',
            // same segmentation as the live trail: invalid fixes never place a vertex (I6), and a
            // no-fix stretch becomes a dashed connector rather than a straight line never driven
            features: buildTrailFeatures(
              trackPoints.map((p) => ({ lon: p.lon, lat: p.lat, fixValid: p.fixValid, fixTimeMs: Date.parse(p.fixTime) })),
            ),
          },
    [trackPoints, snap.selectedId],
  )

  // ── geofences ────────────────────────────────────────────────────────────
  /** Zones start visible; hiding one is a deliberate act and survives re-fetches of the list. */
  const [hiddenFences, setHiddenFences] = useState<ReadonlySet<string>>(() => new Set())
  const fences = useMemo(() => geofencesQ.data ?? [], [geofencesQ.data])
  const visibleFences = useMemo(
    () => new Set(fences.filter((g) => !hiddenFences.has(g.id)).map((g) => g.id)),
    [fences, hiddenFences],
  )
  const fenceFeatures = useMemo(
    () => (layers.geofences ? geofenceFeatures(fences.filter((g) => visibleFences.has(g.id))) : EMPTY_FC),
    [fences, visibleFences, layers.geofences],
  )
  const toggleFence = (id: string) =>
    setHiddenFences((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div
      className={cn('flex flex-col', full ? 'fixed inset-0 z-50 bg-bg' : 'absolute inset-0')}
      data-testid="map-workspace"
    >
      {/* ── toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2 py-2 md:px-4">
        <button
          type="button"
          onClick={() => setListOpen((o) => !o)}
          aria-label={t('map.toggleList')}
          aria-pressed={listOpen}
          data-testid="map-toggle-list"
          className="hidden h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-bg hover:text-text lg:grid"
        >
          <PanelLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="truncate text-sm font-semibold text-text">{t('map.title')}</span>
        {/* admin idiom (ADR-028) tone Badge; live region so AT hears the drop to reconnecting.
            First-ever connect ('connecting') is a neutral "Connecting…", NOT the warning-tone
            "Reconnecting…" — that stays for a 'closed' drop after we were open. */}
        <Badge
          tone={snap.connection === 'open' ? 'success' : snap.connection === 'connecting' ? 'neutral' : 'warning'}
          role="status"
          aria-live="polite"
          data-testid="conn-badge"
        >
          {snap.connection === 'open' ? t('map.live') : snap.connection === 'connecting' ? t('map.connecting') : t('map.reconnecting')}
        </Badge>

        {/* The fleet's headline numbers, doubling as the filter. Only where there is room for them:
            the same chips are inside the panel at every width. */}
        <div className="hidden items-center gap-1.5 xl:flex">
          {([
            ['online', counts.online],
            ['stale', counts.stale],
            ['offline', counts.offline],
            ['silent', counts.silent],
          ] as const).map(([id, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter((f) => (f === id ? 'all' : id))}
              aria-pressed={filter === id}
              data-testid={`toolbar-filter-${id}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                filter === id ? 'border-accent text-accent' : 'border-line text-muted hover:text-text',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  id === 'online' ? 'bg-success' : id === 'stale' ? 'bg-warn' : 'bg-muted/60',
                )}
                aria-hidden
              />
              {n} {t(`deviceList.filter.${id}`)}
            </button>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            data-testid="map-pause"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted transition-colors hover:text-text"
          >
            {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
            <span className="hidden sm:inline">{paused ? t('map.resume') : t('map.pause')}</span>
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setLayersOpen((o) => !o)}
              aria-expanded={layersOpen}
              data-testid="map-layers"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2 text-xs text-muted transition-colors hover:text-text"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">{t('map.layers.title')}</span>
            </button>
            {layersOpen && (
              <LayersMenu
                layers={layers}
                onChange={(next) => setLayers(next)}
                fences={fences}
                visibleFences={visibleFences}
                onToggleFence={toggleFence}
                onClose={() => setLayersOpen(false)}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            aria-label={t('map.fullscreen')}
            aria-pressed={full}
            data-testid="map-fullscreen"
            className="hidden h-8 w-8 place-items-center rounded-md border border-line text-muted transition-colors hover:text-text sm:grid"
          >
            {full ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </div>

      {/* ── body: fleet | map | inspector ───────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1">
        {listOpen && (
          /* Below lg the fleet list and the inspector share the bottom sheet: you pick a vehicle
             from the list, and the vehicle replaces it. Hiding the list outright — as a bare
             `hidden lg:flex` does — left a phone with a map and no way to choose anything. */
          <aside
            className={cn(
              'absolute inset-x-0 bottom-0 z-10 max-h-[60%] flex-col overflow-hidden border-t border-line bg-surface',
              'lg:static lg:inset-auto lg:z-auto lg:flex lg:max-h-none lg:w-[280px] lg:shrink-0 lg:border-r lg:border-t-0 xl:w-[300px]',
              selected ? 'hidden' : 'flex',
            )}
          >
            <DeviceList
              devices={snap.devices}
              silent={silent}
              selectedId={snap.selectedId}
              onSelect={(id) => liveStore.select(id)}
              nameOf={nameOf}
              detailOf={detailOf}
              filter={filter}
              onFilter={setFilter}
              follow={snap.follow}
              onFollow={(v) => liveStore.setFollow(v)}
              // still connecting/seeding: show a loader rather than flash "No devices yet"
              loading={devices.isLoading || (snap.devices.length === 0 && snap.connection !== 'open')}
            />
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <LiveMap layers={layers} geofences={fenceFeatures} history={history} labelOf={nameOf} />

            {/* What just happened, without leaving the map. Wide screens only — it is the first
                thing that should give up its space. */}
            {(eventsQ.data?.length ?? 0) > 0 && (
              <div
                className="absolute bottom-3 right-3 hidden w-72 overflow-hidden rounded-card border border-line bg-surface/90 shadow-card backdrop-blur 2xl:block"
                data-testid="event-ticker"
              >
                <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                  <Bell className="h-3.5 w-3.5 text-muted" aria-hidden />
                  <span className="text-[11px] font-medium text-text">{t('map.eventFeed')}</span>
                </div>
                <ul className="max-h-40 overflow-y-auto">
                  {(eventsQ.data ?? []).map((e) => (
                    <li key={e.id} className="border-b border-line/60 px-3 py-1.5 text-[11px] last:border-b-0">
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate font-medium text-text">{nameOf(e.deviceId)}</span>
                        <span className="shrink-0 text-muted">{t(`events.kind.${e.kind}`, { defaultValue: e.kind })}</span>
                      </div>
                      <div className="truncate text-muted">{dt(e.at)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <Timeline
            deviceId={snap.selectedId}
            name={snap.selectedId === null ? null : nameOf(snap.selectedId)}
            points={trackPoints}
            loading={track.isLoading}
            truncated={track.data?.truncated ?? false}
            onScrub={(p) => liveStore.setScrub(p)}
          />
        </div>

        {selected && (
          /* A rail on a wide screen; a bottom sheet on a narrow one. Not `xl:flex` alone: that
             left every viewport under 1280px with a selected device and no way to see it, which is
             worse than the floating card this replaced. */
          <aside
            /* A rail from xl, a bottom sheet below it. Docking at lg made the map column ~164px on
               a 1024px screen — narrower than either panel, on the very breakpoint where docking
               first engages. The sheet keeps the device reachable at every width. */
            className="absolute inset-x-0 bottom-0 z-20 flex max-h-[60%] flex-col overflow-hidden border-t border-line bg-surface xl:static xl:inset-auto xl:z-auto xl:max-h-none xl:w-[360px] xl:shrink-0 xl:border-l xl:border-t-0"
            data-testid="inspector-rail"
          >
            <Inspector
              live={selected}
              device={registryRow}
              name={nameOf(selected.ev.deviceId)}
              driver={detailOf(selected.ev.deviceId)?.driver ?? null}
              follow={snap.follow}
              trail={snap.trail}
              canWrite={canWrite}
              geofences={fences}
              visibleFences={visibleFences}
              onToggleFence={toggleFence}
              onFollow={(v) => liveStore.setFollow(v)}
              onTrail={(v) => liveStore.setTrail(v)}
              onClose={() => liveStore.select(null)}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * The layer switchboard.
 *
 * Zone visibility lives here as well as in the inspector's own tab, because the two questions are
 * different: "show me this vehicle's zones" belongs to the vehicle, and "stop drawing zones over my
 * city" belongs to the map.
 */
function LayersMenu({
  layers,
  onChange,
  fences,
  visibleFences,
  onToggleFence,
  onClose,
}: {
  layers: MapLayers
  onChange: (next: MapLayers) => void
  fences: { id: string; name: string; color: string }[]
  visibleFences: ReadonlySet<string>
  onToggleFence: (id: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  // Escape closes it, because a menu that only closes by clicking the scrim is a menu keyboard
  // users cannot dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows = Object.keys(DEFAULT_LAYERS) as (keyof MapLayers)[]
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        className="absolute right-0 top-10 z-40 w-64 rounded-card border border-line bg-surface p-3 shadow-card"
        data-testid="layers-menu"
        role="dialog"
        aria-label={t('map.layers.title')}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-text">{t('map.layers.title')}</span>
          <button type="button" onClick={onClose} aria-label={t('info.close')} className="text-muted hover:text-text">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((key) => (
            <label key={key} className="flex cursor-pointer items-center justify-between gap-2 text-xs text-text">
              <span>{t(`map.layers.${key}`)}</span>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => onChange({ ...layers, [key]: !layers[key] })}
                data-testid={`layer-${key}`}
                className="h-3.5 w-3.5 accent-[var(--admin-brand)]"
              />
            </label>
          ))}
        </div>
        {fences.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <div className="mb-1.5 text-[11px] font-medium text-muted">{t('map.layers.fenceVisibility')}</div>
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {fences.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-2 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={visibleFences.has(g.id)}
                    onChange={() => onToggleFence(g.id)}
                    className="h-3.5 w-3.5 accent-[var(--admin-brand)]"
                  />
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: g.color }} aria-hidden />
                  <span className="truncate">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
