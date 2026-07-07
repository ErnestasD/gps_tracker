import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { DeviceList } from '@/components/DeviceList'
import { InfoCard } from '@/components/InfoCard'
import { LiveMap } from '@/components/LiveMap'
import { Badge } from '@/components/ui/badge'
import { getLastPositions, getWsTicket, wsUrl, ApiError } from '@/lib/api'
import { liveStore } from '@/lib/liveStore'
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

  const selected = snap.selectedId !== null ? snap.devices.find((d) => d.ev.deviceId === snap.selectedId) : undefined

  return (
    <>
      <LiveMap />
      <DeviceList devices={snap.devices} selectedId={snap.selectedId} onSelect={(id) => liveStore.select(id)} />
      {selected && (
        <InfoCard
          device={selected}
          follow={snap.follow}
          trail={snap.trail}
          onFollow={(v) => liveStore.setFollow(v)}
          onTrail={(v) => liveStore.setTrail(v)}
          onClose={() => liveStore.select(null)}
        />
      )}
      <div className="absolute right-14 top-4 z-10">
        <Badge variant={snap.connection === 'open' ? 'success' : 'warn'} data-testid="conn-badge">
          {snap.connection === 'open' ? t('map.live') : t('map.reconnecting')}
        </Badge>
      </div>
    </>
  )
}
