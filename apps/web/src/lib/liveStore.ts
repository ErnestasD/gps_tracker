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

/**
 * What the scrubber is pointing at.
 *
 * Three states, not two. `null` means live; a point means "the vehicle was here"; and `'unknown'`
 * means "the operator has named a moment we hold no position for" — before the window's first fix,
 * or in a stretch where the tracker never had one.
 *
 * `'unknown'` exists because folding it into `null` made the map fly to the vehicle's PRESENT
 * position while the readout named a moment 24 hours ago. That is not a smaller lie than showing
 * nothing; it is a bigger one, and it fired on every press of "-24 h" and on every replay.
 */
export type ScrubState = { lon: number; lat: number; course: number | null } | 'unknown' | null

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
  scrub: ScrubState
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

/** By VALUE, not identity: the scrubber builds a fresh object per slider step, and a drag across a
 *  parked vehicle resolves to the same position for hundreds of consecutive steps. */
const sameScrub = (a: ScrubState, b: ScrubState): boolean =>
  a === b || (a !== null && b !== null && a !== 'unknown' && b !== 'unknown' && a.lon === b.lon && a.lat === b.lat && a.course === b.course)

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
    // The selection check is ABOVE the delete guard on purpose: a device that is selected but no
    // longer in `byId` must still lose its scrub and its selection, and returning early on the
    // delete left the store holding a scrub for a vehicle that no longer exists.
    const wasSelected = this.snapshot.selectedId === deviceId
    const existed = this.byId.delete(deviceId)
    if (wasSelected) this.deselect()
    if (!existed) {
      if (wasSelected) this.flush(true)
      return false
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
        if (this.snapshot.selectedId === id) this.deselect()
        removed = true
      }
    }
    if (removed) {
      this.dirty = true
      this.flush(true)
    }
  }

  /**
   * Drop the selection and everything that belonged to it.
   *
   * One place, because there were three and one of them forgot the scrub: when another tab retired
   * the selected device, `retain()` cleared the selection and the trail but left the scrub point
   * set, so every later frame carried a scrub — which makes the follow branch unreachable. Turning
   * Follow on then silently did nothing, with no marker and no text to explain why.
   */
  private deselect(): void {
    this.trailPoints = []
    this.scrubPoint = null
    this.snapshot = { ...this.snapshot, selectedId: null, follow: false }
  }

  // ── UI state ──────────────────────────────────────────────────────────────
  select(deviceId: string | null): void {
    if (deviceId === this.snapshot.selectedId) return
    this.trailPoints = [] // trail is per-selection, from selection time onward
    /**
     * The scrub point belongs to the device it was taken from, and must die with the selection.
     *
     * It used to survive: closing the inspector unmounted the Timeline without its own onClose, so
     * the point stayed set and every 1 Hz frame re-centred the map on another vehicle's past —
     * forever, and unpannable, with nothing on screen saying why.
     */
    this.scrubPoint = null
    this.snapshot = { ...this.snapshot, selectedId: deviceId, follow: deviceId !== null && this.snapshot.follow }
    this.flush(true)
  }

  /**
   * Point the map at a moment in this device's past, `'unknown'` when we hold no position for it,
   * or back to live with null.
   *
   * A drag fires this dozens of times a second (React maps a range's `onChange` to the native
   * `input` event) and replay fires it ~11 times a second, so it must be cheap: it pushes a MAP
   * frame only — no React emit, no fleet re-sort — and `pushMapFrame` reuses the cached device and
   * trail collections because scrubbing changes neither. It used to call `flush(true)`, which
   * rebuilt every marker and up to 3600 trail vertices per tick and re-rendered the whole page.
   */
  setScrub(point: ScrubState): void {
    if (sameScrub(point, this.scrubPoint)) return
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
    // Anything that reaches a flush may have moved a marker, so the cached collections die here —
    // exactly once, and only on the path that can change them. Scrubbing never comes through here,
    // which is the whole point of the cache.
    this.geo = null
    this.pushMapFrame()
    this.emit()
  }

  /**
   * The selected device's last VALID fix, for a camera move the operator asked for by hand.
   *
   * Not `selected.ev.lon/lat`: an invalid record carries 0/0, and "centre on this vehicle" landing
   * in the Gulf of Guinea is the same defect `DeviceLive.fix` exists to prevent.
   */
  selectedFix(): { lon: number; lat: number } | null {
    const id = this.snapshot.selectedId
    return id === null ? null : (this.byId.get(id)?.fix ?? null)
  }

  onMapFrame(sink: ((frame: MapFrame) => void) | null): void {
    this.mapSink = sink
    if (sink) this.pushMapFrame()
  }

  private scrubPoint: ScrubState = null
  /**
   * The last built collections, reused when only the scrub moved.
   *
   * Rebuilt on every `flush`, and ONLY there. Scrubbing a 24-hour slider fires dozens of times a
   * second and replay ~11 times a second; rebuilding every marker and up to 3600 trail vertices per
   * tick is the per-message work the 1 Hz flush exists to avoid.
   */
  private geo: { devices: GeoJSON.FeatureCollection; trail: GeoJSON.FeatureCollection } | null = null

  private pushMapFrame(): void {
    if (!this.mapSink) return
    const { selectedId, follow } = this.snapshot
    if (this.geo === null) {
      // flatMap, not map: a device with no valid fix YET contributes no marker at all rather than a
      // confident dot at 0,0 — see `DeviceLive.fix`.
      const features: GeoJSON.Feature[] = this.snapshot.devices.flatMap(({ ev, status, fix }) =>
        fix === null
          ? []
          : [{
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [fix.lon, fix.lat] },
              // no `selected` property: the halo is a `setFilter` on the frame's own selected id,
              // and carrying it here made every row click invalidate the whole marker collection
              properties: { deviceId: ev.deviceId, course: fix.course, status },
            }],
      )
      this.geo = {
        devices: { type: 'FeatureCollection', features },
        trail: { type: 'FeatureCollection', features: buildTrailFeatures(this.trailPoints) },
      }
    }
    const selectedLive = selectedId !== null ? (this.byId.get(selectedId) ?? null) : null
    const selected = selectedLive?.ev ?? null
    const selectedFix = selectedLive?.fix ?? null
    this.mapSink({ devices: this.geo.devices, trail: this.geo.trail, selected, selectedFix, follow, scrub: this.scrubPoint })
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
    this.geo = null
    this.byId.clear()
    this.trailPoints = []
    this.dirty = false
    this.snapshot = { devices: [], selectedId: null, follow: false, trail: false, connection: 'closed' }
    this.emit()
  }
}

export const liveStore = new LiveStore()
