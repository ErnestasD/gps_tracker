import { liveEventSchema, type LiveEvent } from '@orbetra/shared'

export type DeviceStatus = 'online' | 'stale' | 'offline'
export type ConnState = 'connecting' | 'open' | 'closed'

export interface DeviceLive {
  ev: LiveEvent
  status: DeviceStatus
}

export interface LiveSnapshot {
  /** Sorted by deviceId — stable list order for the panel. */
  devices: DeviceLive[]
  selectedId: string | null
  follow: boolean
  trail: boolean
  connection: ConnState
}

export interface TrailPoint {
  lon: number
  lat: number
  fixValid: boolean
  fixTimeMs: number
}

export interface MapFrame {
  devices: GeoJSON.FeatureCollection
  trail: GeoJSON.FeatureCollection
  selected: LiveEvent | null
  follow: boolean
}

// StatusDot semantics (DASHBOARD_UI_SPEC §3): online ≤60 s freshness, then stale,
// offline after 10 min. One place — DeviceList/InfoCard/map arrows all read this.
export const ONLINE_MS = 60_000
export const STALE_MS = 600_000
const TRAIL_CAP = 3_600 // ≈1 h at 1 Hz; ring buffer, oldest dropped

const statusOf = (ageMs: number): DeviceStatus =>
  ageMs <= ONLINE_MS ? 'online' : ageMs <= STALE_MS ? 'stale' : 'offline'

const lineFeature = (coordinates: [number, number][], gap: boolean): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties: { gap },
})

/**
 * I5 trail segmentation (E02-7, spec §4 "Invalid-fix gap = dashed"): runs of
 * consecutive VALID points become solid segments (gap=false); two valid runs
 * separated by ≥1 invalid point are joined by a dashed connector (gap=true).
 * Invalid points' own coordinates are never rendered — per §3.4 they merely
 * repeat the last valid position while the device has no fix.
 */
export function buildTrailFeatures(points: readonly TrailPoint[]): GeoJSON.Feature[] {
  // split into runs of consecutive valid points — runs are separated by ≥1
  // invalid point by construction
  const runs: TrailPoint[][] = []
  let run: TrailPoint[] = []
  for (const p of points) {
    if (p.fixValid) {
      run.push(p)
    } else if (run.length > 0) {
      runs.push(run)
      run = []
    }
  }
  if (run.length > 0) runs.push(run)

  const features: GeoJSON.Feature[] = []
  for (let i = 0; i < runs.length; i++) {
    const current = runs[i]!
    if (i > 0) {
      // dashed connector across the no-fix stretch (skip zero-length: the device
      // may resume exactly where it lost the fix)
      const prev = runs[i - 1]!
      const from = prev[prev.length - 1]!
      const to = current[0]!
      if (from.lon !== to.lon || from.lat !== to.lat) {
        features.push(lineFeature([[from.lon, from.lat], [to.lon, to.lat]], true))
      }
    }
    if (current.length >= 2) {
      features.push(lineFeature(current.map((p) => [p.lon, p.lat]), false))
    }
  }
  return features
}

/**
 * The perf keystone (E02-6 AC: 500 devices, no jank). WS messages only mutate a
 * Map between flushes — zero React/Mapbox work per message. A 1 Hz flush rebuilds
 * the GeoJSON for the map sink and a React snapshot with STABLE refs for unchanged
 * devices, so memoized DeviceList rows skip re-render. Max-wins on fixTimeMs mirrors
 * the server's LiveState (buffered floods must never regress a marker).
 */
export class LiveStore {
  private byId = new Map<string, DeviceLive>()
  private listeners = new Set<() => void>()
  private mapSink: ((frame: MapFrame) => void) | null = null
  private trailPoints: TrailPoint[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private dirty = false
  private snapshot: LiveSnapshot = {
    devices: [],
    selectedId: null,
    follow: false,
    trail: false,
    connection: 'closed',
  }

  constructor(private readonly now: () => number = Date.now) {}

  // ── ingest ────────────────────────────────────────────────────────────────
  ingestRaw(data: string): void {
    let json: unknown
    try {
      json = JSON.parse(data)
    } catch {
      return // crafted/broken frame — drop
    }
    const parsed = liveEventSchema.safeParse(json)
    if (!parsed.success) return // schema drift fails loudly in tests, silently here
    this.ingest(parsed.data)
  }

  // Trust boundary note: byId grows one entry per distinct deviceId the tenant's
  // WS channel emits — bounded by the seeded registry today. No client-side cap;
  // E03-3 device CRUD becomes the authoritative bound.
  ingest(ev: LiveEvent): void {
    const current = this.byId.get(ev.deviceId)
    if (current && current.ev.fixTimeMs >= ev.fixTimeMs) return // max-wins
    this.byId.set(ev.deviceId, { ev, status: statusOf(this.now() - ev.fixTimeMs) })
    if (this.snapshot.trail && ev.deviceId === this.snapshot.selectedId) {
      this.trailPoints.push({ lon: ev.lon, lat: ev.lat, fixValid: ev.fixValid, fixTimeMs: ev.fixTimeMs })
      if (this.trailPoints.length > TRAIL_CAP) this.trailPoints.shift()
    }
    this.dirty = true
  }

  seed(events: LiveEvent[]): void {
    for (const ev of events) this.ingest(ev)
    this.flush()
  }

  // ── UI state ──────────────────────────────────────────────────────────────
  select(deviceId: string | null): void {
    if (deviceId === this.snapshot.selectedId) return
    this.trailPoints = [] // trail is per-selection, from selection time onward
    this.snapshot = { ...this.snapshot, selectedId: deviceId, follow: deviceId !== null && this.snapshot.follow }
    this.flush(true)
  }

  setFollow(follow: boolean): void {
    this.snapshot = { ...this.snapshot, follow }
    this.flush(true)
  }

  setTrail(trail: boolean): void {
    if (!trail) this.trailPoints = []
    this.snapshot = { ...this.snapshot, trail }
    this.flush(true)
  }

  setConnection(connection: ConnState): void {
    if (connection === this.snapshot.connection) return
    this.snapshot = { ...this.snapshot, connection }
    this.emit()
  }

  // ── flush loop ────────────────────────────────────────────────────────────
  start(intervalMs = 1_000): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      // hidden tab: skip ALL visual work; the Map keeps absorbing WS messages
      if (typeof document !== 'undefined' && document.hidden) return
      this.flush()
    }, intervalMs)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** Rebuild snapshot + map frame. Statuses are time-based, so flush re-evaluates
   * them even without new data; unchanged devices keep their object identity. */
  flush(force = false): void {
    const now = this.now()
    let changed = this.dirty || force
    const next: DeviceLive[] = []
    for (const [, dev] of this.byId) {
      const status = statusOf(now - dev.ev.fixTimeMs)
      if (status !== dev.status) {
        this.byId.set(dev.ev.deviceId, { ev: dev.ev, status })
        changed = true
      }
    }
    if (!changed) return
    for (const [, dev] of this.byId) next.push(dev)
    next.sort((a, b) => a.ev.deviceId.localeCompare(b.ev.deviceId, undefined, { numeric: true }))
    this.dirty = false
    this.snapshot = { ...this.snapshot, devices: next }
    this.pushMapFrame()
    this.emit()
  }

  onMapFrame(sink: ((frame: MapFrame) => void) | null): void {
    this.mapSink = sink
    if (sink) this.pushMapFrame()
  }

  private pushMapFrame(): void {
    if (!this.mapSink) return
    const { selectedId, follow } = this.snapshot
    const features: GeoJSON.Feature[] = this.snapshot.devices.map(({ ev, status }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [ev.lon, ev.lat] },
      properties: {
        deviceId: ev.deviceId,
        course: ev.course ?? 0,
        status,
        selected: ev.deviceId === selectedId,
      },
    }))
    const trail: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: buildTrailFeatures(this.trailPoints),
    }
    const selected = selectedId !== null ? (this.byId.get(selectedId)?.ev ?? null) : null
    this.mapSink({ devices: { type: 'FeatureCollection', features }, trail, selected, follow })
  }

  // ── useSyncExternalStore contract ─────────────────────────────────────────
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getSnapshot = (): LiveSnapshot => this.snapshot

  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  /** Test/logout helper. */
  reset(): void {
    this.byId.clear()
    this.trailPoints = []
    this.dirty = false
    this.snapshot = { devices: [], selectedId: null, follow: false, trail: false, connection: 'closed' }
    this.emit()
  }
}

export const liveStore = new LiveStore()
