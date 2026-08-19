import { liveEventSchema, type LiveEvent } from '@orbetra/shared'

export type DeviceStatus = 'online' | 'stale' | 'offline'
export type ConnState = 'connecting' | 'open' | 'closed'

export interface DeviceLive {
  ev: LiveEvent
  status: DeviceStatus
  /**
   * The last position this device was actually SEEN at — carried forward across invalid fixes,
   * `null` until the very first valid one.
   *
   * Invariant I6 says an invalid fix must never affect map trails, and `buildTrailFeatures` honours
   * it, but the device MARKER read `ev.lon/ev.lat` unconditionally. A tracker reporting
   * `satellites=0` sends lat/lon `0/0`, so a brand-new device sitting indoors in Vilnius was drawn
   * in the Gulf of Guinea — with the info card correctly saying "no GPS fix" right beside it.
   * Showing a customer their vehicle 6000 km out to sea is worse than showing nothing.
   *
   * Per spec §3.4 an invalid record merely repeats the last valid position while the device has no
   * fix, so the marker holds still rather than jumping — and a device that has NEVER had a fix is
   * not placed on the map at all. It stays in the list, where "no GPS fix" is the honest answer.
   */
  fix: { lon: number; lat: number; course: number } | null
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
  /**
   * A historic position the operator is scrubbing to, or null when the map is live.
   *
   * Kept beside the live frame rather than replacing it: the fleet keeps moving underneath while
   * one vehicle is examined in the past, and conflating the two would make "where is everyone now"
   * unanswerable the moment someone opened the timeline.
   */
  scrub: { lon: number; lat: number; course: number | null } | null
  /** Where to CENTRE on when following — the selected device's last valid fix, `null` if it has
   *  never had one. Separate from `selected` because that event's own lat/lon may be an invalid
   *  0/0, and following it would fly the map into the Atlantic (see `DeviceLive.fix`). */
  selectedFix: { lon: number; lat: number } | null
  follow: boolean
}

/**
 * StatusDot semantics (DASHBOARD_UI_SPEC §3). One place — DeviceList/InfoCard/map arrows all read
 * this.
 *
 * `online` was 60 s, which is shorter than how often a Teltonika device actually speaks. These
 * trackers BATCH: they record on distance/angle/time and then send on a separate *send period*,
 * 120 s by default on the FT platform. So a device driving perfectly — recording every 1–5 s, as an
 * FTC887 was measured doing — arrives in bursts up to two minutes apart, and a 60 s window made it
 * flap between "online" and "stale" the whole trip. The dot was reporting our impatience, not the
 * vehicle.
 *
 * 180 s covers the default send period with margin. It is a floor, not a guess at any one device:
 * a tracker configured to send immediately still shows online instantly, and one that has genuinely
 * stopped talking still goes stale, just without the false alarm in between.
 */
export const ONLINE_MS = 180_000
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
    // only a VALID fix moves the marker; an invalid one keeps whatever we last knew (see `fix`)
    const fix = ev.fixValid ? { lon: ev.lon, lat: ev.lat, course: ev.course ?? 0 } : (current?.fix ?? null)
    this.byId.set(ev.deviceId, { ev, status: statusOf(this.now() - ev.fixTimeMs), fix })
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

  /** Remove a single device (E03-3 device CRUD is the authoritative bound): retiring/erasing a
   * device must drop its marker + DeviceList row immediately, not leave it decaying to 'offline'
   * until logout. If it was the selected/trailed device, clear that too. Returns whether it existed. */
  evict(deviceId: string): boolean {
    if (!this.byId.delete(deviceId)) return false
    if (this.snapshot.selectedId === deviceId) {
      this.trailPoints = []
      this.snapshot = { ...this.snapshot, selectedId: null, follow: false }
    }
    this.dirty = true
    this.flush(true)
    return true
  }

  /** Reconcile the live set to the authoritative active registry: drop any live device that is no
   * longer present (retired/erased/removed — possibly by another tab or admin). No-op when every
   * live device is still present, so it never churns the snapshot needlessly. A device still
   * streaming fresh fixes (≤ ONLINE_MS) is KEPT even if the ['devices'] cache hasn't refetched it
   * yet — the WS stream is ground truth for presence; the stale registry cache is not. */
  retain(activeIds: Iterable<string>): void {
    const keep = activeIds instanceof Set ? activeIds : new Set(activeIds)
    const now = this.now()
    let removed = false
    for (const id of [...this.byId.keys()]) {
      const dev = this.byId.get(id)
      if (dev !== undefined && now - dev.ev.fixTimeMs <= ONLINE_MS) continue // actively streaming — keep
      if (!keep.has(id) && this.byId.delete(id)) {
        if (this.snapshot.selectedId === id) {
          this.trailPoints = []
          this.snapshot = { ...this.snapshot, selectedId: null, follow: false }
        }
        removed = true
      }
    }
    if (removed) {
      this.dirty = true
      this.flush(true)
    }
  }

  // ── UI state ──────────────────────────────────────────────────────────────
  select(deviceId: string | null): void {
    if (deviceId === this.snapshot.selectedId) return
    this.trailPoints = [] // trail is per-selection, from selection time onward
    this.snapshot = { ...this.snapshot, selectedId: deviceId, follow: deviceId !== null && this.snapshot.follow }
    this.flush(true)
  }

  /** Point the map at a moment in this device's past, or back to live with null. */
  setScrub(point: { lat: number; lon: number; course: number | null } | null): void {
    this.scrubPoint = point
    this.pushMapFrame()
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
        this.byId.set(dev.ev.deviceId, { ev: dev.ev, status, fix: dev.fix })
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

  private scrubPoint: { lat: number; lon: number; course: number | null } | null = null

  private pushMapFrame(): void {
    if (!this.mapSink) return
    const { selectedId, follow } = this.snapshot
    // flatMap, not map: a device with no valid fix YET contributes no marker at all rather than a
    // confident dot at 0,0 — see `DeviceLive.fix`.
    const features: GeoJSON.Feature[] = this.snapshot.devices.flatMap(({ ev, status, fix }) =>
      fix === null
        ? []
        : [{
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [fix.lon, fix.lat] },
            properties: {
              deviceId: ev.deviceId,
              course: fix.course,
              status,
              selected: ev.deviceId === selectedId,
            },
          }],
    )
    const trail: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: buildTrailFeatures(this.trailPoints),
    }
    const selectedLive = selectedId !== null ? (this.byId.get(selectedId) ?? null) : null
    const selected = selectedLive?.ev ?? null
    const selectedFix = selectedLive?.fix ?? null
    this.mapSink({ devices: { type: 'FeatureCollection', features }, trail, selected, selectedFix, follow, scrub: this.scrubPoint })
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
    this.scrubPoint = null
    this.byId.clear()
    this.trailPoints = []
    this.dirty = false
    this.snapshot = { devices: [], selectedId: null, follow: false, trail: false, connection: 'closed' }
    this.emit()
  }
}

export const liveStore = new LiveStore()
