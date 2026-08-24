import { isNullIsland, liveEventSchema, type LiveEvent } from '@orbetra/shared'

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
  /**
   * Speed as the device reported it. REQUIRED, not optional: while it was optional, one of the
   * three callers quietly omitted it and drew a different track for the same device on a different
   * page, and the I5 test fixtures omitted it too — which made them structurally blind to the very
   * behaviour they guard. `null` still means "this model does not report it".
   */
  speed: number | null
  /**
   * AVL 240 — the device's own statement about whether it is moving. REQUIRED for the same reason
   * `speed` is: while it was optional a caller could omit it silently. `null` is the honest value
   * where the source does not carry it, and the live WS event does not — `liveEventSchema` has no
   * movement field. One residual divergence follows and is not closed here: for a model whose speed
   * is UNREPORTED, the 24-hour track can gate on movement and the live trail cannot. Teltonika
   * always sends speed (it is null only when the worker's range check rejects it), so this is a
   * stated gap, not a live defect.
   * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
   */
  movement: boolean | null
}

/**
 * Metres a STATIONARY record must sit from the last drawn point before it earns a vertex.
 *
 * Not smoothing, and not a guess about where the vehicle "really" was: a record whose own speed is
 * 0 is the device stating it did not move, and a line drawn between two such records claims a
 * journey the device says never happened. Measured on the founder's parked FTC887 with 30
 * satellites: 35 records over six hours, every one reporting speed 0 and movement false, and 91
 * metres of accumulated point-to-point distance with a largest single step of 11.9 m. The map drew
 * all 91 metres as a scribble across a car park.
 *
 * 25 m keeps a wide margin over that while staying well under any real movement: even a device whose
 * movement sensor wrongly reported "stopped" while driving would put successive fixes far past this
 * gate. It is deliberately NOT tuned for the 40–100 m jitter of an urban canyon — there, successive
 * fixes clear the gate and every point is drawn, exactly as today. This filter fails OPEN: where it
 * cannot be confident, it draws.
 */
const JITTER_GATE_M = 25

/** Metres between two coordinates — equirectangular, which at these distances is exact enough and
 *  far cheaper than haversine for a 3600-point trail redrawn on every flush. The longitude delta is
 *  wrapped: without it a step across the antimeridian measures 23 000 km, and a function whose only
 *  job is a 25 m comparison must not be wrong anywhere on Earth. */
function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLon = ((bLon - aLon + 540) % 360) - 180
  const latM = (bLat - aLat) * 111_320
  const lonM = dLon * 111_320 * Math.cos((aLat * Math.PI) / 180)
  return Math.hypot(latM, lonM)
}

/**
 * The device says it is not moving.
 *
 * A REPORTED zero speed is the strongest evidence there is, and it decides on its own. `movement`
 * (AVL 240) only speaks where speed is silent. Its SOURCE is a device setting, not a fixed meaning,
 * so "movement true" is not a promise that the vehicle was displaced — measured on one wired FTC887
 * over 24 h, the records reporting speed 0 AND movement true were the *most* static of the day, 383
 * of them sharing 54 m, while the movement-false bucket carried 220 m across 142. That is an
 * observation about that installation rather than a claim about the element, and it is enough to
 * say a reported zero must not be overridden by it.
 *
 * The cost is recorded rather than rediscovered: a tracker whose whole working area is smaller than
 * the gate — a yard asset shuttling 15 m — collapses its shift to one point. GNSS cannot honestly
 * separate that from jitter, and inventing the difference is what this module exists not to do.
 *
 * A `null` speed is not zero — it is "unreported" — and there `movement === false` is the only
 * statement we have. Neither `null` nor a missing field counts as agreement: this gate fails OPEN.
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 */
const isStationary = (p: TrailPoint): boolean => p.speed === 0 || (p.speed === null && p.movement === false)

/**
 * Drop the vertices a parked vehicle's GPS jitter would otherwise draw.
 *
 * Only records the device itself calls stationary are ever dropped, and only while they stay within
 * the gate of the last point we kept — so a vehicle towed away with the engine off still draws the
 * move, and a real drive is untouched. Invalid fixes pass through unchanged: they carry no vertex
 * anyway (I6) and they are what separates the solid runs from the dashed no-fix connectors, so
 * dropping one would silently merge two runs the vehicle did not join.
 *
 * A parked stretch collapses to its FIRST record and nothing else.
 *
 * The anchor is carried across no-fix stretches, which is what makes that true of a car park with a
 * patchy sky rather than only of a clean one. An earlier version held the last
 * one back too, to stop a one-point run "losing its dashed connector" — but that never happened:
 * `buildTrailFeatures` builds the connector from `prev[prev.length - 1]` to `current[0]` whatever
 * the run length, so a single-point run supplies its endpoint perfectly well. Only the solid LINE
 * goes, which is correct — a parked run has no line to draw. The mechanism bought nothing and cost
 * the whole filter: it handed every held-back record back at the next invalid fix, so a car park
 * with a patchy sky view (records valid, valid, no-fix, repeat) kept every single point.
 */
export function dropStationaryJitter(points: readonly TrailPoint[]): TrailPoint[] {
  const out: TrailPoint[] = []
  let anchor: TrailPoint | null = null
  for (const p of points) {
    if (!p.fixValid) {
      /**
       * The anchor SURVIVES a no-fix stretch, and that is the whole filter.
       *
       * Resetting it here — so the first valid record after the stretch could never be gated — read
       * as protecting the I5 seam, and instead handed the scribble straight back: a parked car under
       * a patchy sky reports valid, valid, no-fix in a loop, so every third record found a null
       * anchor and was kept unconditionally. Measured on that shape, 90 records: 30 valid points
       * survived and 233 m of line was drawn, in dashes, for a vehicle that never moved.
       *
       * It was also a rule-6 leak in its own right: an INVALID record was deciding which VALID
       * vertices reached the map. Carried, the same 90 records collapse to one point and nothing is
       * drawn — while a vehicle towed 500 m during the outage still draws both seams and the
       * connector, because the far record clears the gate on its own merits.
       */
      out.push(p)
      continue
    }
    if (!isStationary(p)) {
      out.push(p)
      anchor = p
      continue
    }
    if (anchor === null || metresBetween(anchor.lat, anchor.lon, p.lat, p.lon) > JITTER_GATE_M) {
      out.push(p)
      anchor = p
    }
  }
  return out
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
 * The ghost marker: where the vehicle WAS at the scrubbed moment.
 *
 * Pure and here rather than inline in the map, because it encodes a rule that has already been got
 * wrong twice one layer up: a heading we do not have must not be drawn. `hasCourse` decides whether
 * an arrow is rendered at all, and it agrees with `course` about what "missing" means — `?? 0`
 * treating undefined as missing while `!== null` treated it as present would have produced an arrow
 * pointing due north for a record that carried no heading.
 *
 * A course of exactly 0 is a real heading (due north), not a missing one.
 */
export function scrubFeatures(scrub: ScrubState): GeoJSON.FeatureCollection {
  if (scrub === null || scrub === 'unknown') return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [scrub.lon, scrub.lat] },
      properties: { course: typeof scrub.course === 'number' ? scrub.course : 0, hasCourse: typeof scrub.course === 'number' },
    }],
  }
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

/**
 * Can this record be drawn as a place?
 *
 * `fixValid` is the pipeline's answer and is normally the whole story. The second clause is because
 * it was not: on 2026-08-20 the founder's FTC887 reported 0/0 with 34–37 satellites, the pipeline
 * marked it valid (§3.4's rule only covers `satellites == 0`), and the map drew the vehicle in the
 * Gulf of Guinea — the exact failure `DeviceLive.fix` exists to prevent, arriving through the one
 * door it did not watch.
 *
 * The pipeline is fixed too, and that is the real fix. This stays because fifty such rows are
 * already stored, replays and exports will carry them for months, and a client that trusts a
 * coordinate it can see is impossible has no defence when the server is wrong again.
 */
const placeable = (ev: LiveEvent): boolean => ev.fixValid && !isNullIsland(ev.lat, ev.lon)

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
 *
 * A THIRD rule runs above those two since 2026-08-19: the vertices a stationary record would
 * contribute are dropped first (`dropStationaryJitter`), because a parked vehicle's GPS jitter is
 * not a path. It never touches an invalid point, so the run boundaries below are exactly the ones
 * the device's own fix losses drew.
 *
 * It CAN empty a run, and the trade is worth stating. A valid run whose every record is stationary
 * and inside the gate disappears, and the two runs around it then share ONE connector spanning both
 * no-fix stretches and the parked stretch between them — so that dashed line is spatially right to
 * within the gate, but it no longer marks only the window in which the device had no fix. The
 * alternative, keeping one record per run, is what shipped in an earlier round of this fix: on a
 * parked car under a patchy sky it drew 233 m of dashes for a vehicle that never moved.
 */
export function buildTrailFeatures(rawPoints: readonly TrailPoint[]): GeoJSON.Feature[] {
  // A parked vehicle's jitter is not a path. Dropped HERE, at the one place a track becomes
  // geometry, so the live trail and the 24-hour history cannot disagree about it.
  const points = dropStationaryJitter(rawPoints)
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
    const fix = placeable(ev) ? { lon: ev.lon, lat: ev.lat, course: ev.course ?? 0 } : (current?.fix ?? null)
    this.byId.set(ev.deviceId, { ev, status: statusOf(this.now() - ev.fixTimeMs), fix })
    if (this.snapshot.trail && ev.deviceId === this.snapshot.selectedId) {
      // `placeable`, NOT ev.fixValid: the marker above already refuses a stored 0/0, but the trail
      // stored the device's own verdict and drew it anyway. dropStationaryJitter cannot save it
      // either — a 0/0 sits ~6000 km from the anchor, so it clears the jitter gate and BECOMES the
      // anchor. Rule 6 says such a record never affects a map trail; this is where it did.
      this.trailPoints.push({ lon: ev.lon, lat: ev.lat, fixValid: placeable(ev), fixTimeMs: ev.fixTimeMs, speed: ev.speed, movement: null })
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
    /**
     * The loop only visits ids that ARE in byId, so a selection already gone was never deselected
     * here — the same hole `evict` had, one method along.
     *
     * Scoped to what THIS call removed (`!keep.has`), not to "absent from the live set": a device
     * can legitimately be selected while absent from byId — the fleet panel lists devices that have
     * never reported — and deselecting on every `['devices']` settle would make clicking such a row
     * cancel itself.
     */
    const sel = this.snapshot.selectedId
    if (sel !== null && !keep.has(sel) && !this.byId.has(sel)) {
      this.deselect()
      removed = true
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
