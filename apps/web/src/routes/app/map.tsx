import { useQuery } from '@tanstack/react-query'
import { Maximize2, Minimize2, PanelLeft, Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { DeviceList } from '@/components/DeviceList'
import { Inspector } from '@/components/Inspector'
import { LiveMap } from '@/components/LiveMap'
import { Badge } from '@/components/admin/AdminKit'
import { getLastPositions, getWsTicket, wsUrl, ApiError } from '@/lib/api'
import { getCurrentUser } from '@/lib/auth'
import { listDevices } from '@/lib/devices'
import { liveStore } from '@/lib/liveStore'
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

export function MapPage() {
  const { t } = useTranslation()
  const snap = useSyncExternalStore(liveStore.subscribe, liveStore.getSnapshot)
  // the device registry is the authoritative bound (E03-3): reconcile the live set to it so a
  // device retired/removed here or in another tab drops off the map instead of decaying to
  // 'offline' for the rest of the session (liveStore.byId never evicted on its own)
  const devices = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const [listOpen, setListOpen] = useState(true)
  const [full, setFull] = useState(false)
  /** Pausing stops the STORE, not the socket: the feed keeps arriving and the map simply stops
   *  redrawing, so resuming shows the present rather than replaying a backlog. */
  const [paused, setPaused] = useState(false)

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
              // still connecting/seeding: show a loader rather than flash "No devices yet"
              loading={devices.isLoading || (snap.devices.length === 0 && snap.connection !== 'open')}
            />
          </aside>
        )}

        <div className="relative min-w-0 flex-1">
          <LiveMap />
        </div>

        {selected && (
          /* A rail on a wide screen; a bottom sheet on a narrow one. Not `xl:flex` alone: that
             left every viewport under 1280px with a selected device and no way to see it, which is
             worse than the floating card this replaced. */
          <aside
            className="absolute inset-x-0 bottom-0 z-10 flex max-h-[60%] flex-col overflow-y-auto border-t border-line bg-surface lg:static lg:inset-auto lg:max-h-none lg:w-[340px] lg:shrink-0 lg:border-l lg:border-t-0"
            data-testid="inspector-rail"
          >
            <Inspector
              live={selected}
              device={registryRow}
              name={nameOf(selected.ev.deviceId)}
              follow={snap.follow}
              trail={snap.trail}
              canWrite={canWrite}
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
