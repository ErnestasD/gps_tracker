import type { LiveEvent } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { LiveStore, buildTrailFeatures, dropStationaryJitter, scrubFeatures, type MapFrame, type TrailPoint } from '../src/lib/liveStore.js'

const T0 = 1_751_600_000_000

const ev = (deviceId: string, fixTimeMs: number, extra: Partial<LiveEvent> = {}): LiveEvent => ({
  deviceId,
  accountId: null,
  fixTimeMs,
  lat: 54.68,
  lon: 25.27,
  speed: 40,
  course: 90,
  satellites: 9,
  fixValid: true,
  ignition: true,
  priority: 0,
  ...extra,
})

const makeStore = (nowMs: () => number) => new LiveStore(nowMs)

/**
 * A device with no GPS fix must not be drawn where it isn't.
 *
 * A tracker reporting `satellites=0` sends lat/lon 0/0, and invariant I6 says such a record never
 * affects the map. `buildTrailFeatures` already honoured that; the device MARKER did not, so a
 * brand-new FTC887 sitting indoors in Vilnius was drawn in the Gulf of Guinea — with the info card
 * correctly reading "no GPS fix" right next to it. Reported from the live product, 2026-08-18.
 */
describe('an invalid fix never places a marker (invariant I6, read side)', () => {
  const frameOf = (store: LiveStore): MapFrame => {
    let out: MapFrame | null = null
    store.onMapFrame((f) => { out = f })
    store.flush(true)
    return out!
  }

  it('a device whose ONLY fix is invalid gets no marker at all', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { fixValid: false, satellites: 0, lat: 0, lon: 0 }))
    expect(frameOf(store).devices.features).toHaveLength(0)
    // …but it is still in the list — "no GPS fix" is the honest answer, not absence
    expect(store.getSnapshot().devices.map((d) => d.ev.deviceId)).toEqual(['1'])
  })

  it('an invalid fix HOLDS the marker at the last valid position instead of moving it to 0,0', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { lat: 54.68, lon: 25.27, course: 90 }))
    store.ingest(ev('1', T0 + 1_000, { fixValid: false, satellites: 0, lat: 0, lon: 0, course: 0 }))
    const f = frameOf(store).devices.features
    expect(f).toHaveLength(1)
    expect((f[0]!.geometry as GeoJSON.Point).coordinates).toEqual([25.27, 54.68])
    expect(f[0]!.properties!['course']).toBe(90) // the course of a no-fix record is meaningless too
  })

  it('a later VALID fix moves it again', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { fixValid: false, satellites: 0, lat: 0, lon: 0 }))
    store.ingest(ev('1', T0 + 1_000, { lat: 54.9, lon: 23.9 }))
    const f = frameOf(store).devices.features
    expect((f[0]!.geometry as GeoJSON.Point).coordinates).toEqual([23.9, 54.9])
  })

  it('FOLLOW does not fly the map to 0,0 for a device that has never had a fix', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { fixValid: false, satellites: 0, lat: 0, lon: 0 }))
    store.select('1')
    store.setFollow(true)
    const frame = frameOf(store)
    expect(frame.selected?.deviceId).toBe('1') // the info card still has its event
    expect(frame.selectedFix).toBeNull() // …but there is nowhere to centre on
  })
})

describe('the camera targets the map can be pointed at', () => {
  const frameOf = (store: LiveStore): MapFrame => {
    let out: MapFrame | null = null
    store.onMapFrame((f) => { out = f })
    store.flush(true)
    return out!
  }

  it('selectedFix is the last VALID fix, never the raw event', () => {
    // "centre on the selected vehicle" reads this. A no-fix record carries 0/0, and centring on
    // that is the Gulf of Guinea defect with a button attached.
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { lat: 54.68, lon: 25.27 }))
    store.ingest(ev('1', T0 + 1_000, { fixValid: false, satellites: 0, lat: 0, lon: 0 }))
    store.select('1')
    expect(store.selectedFix()).toEqual({ lon: 25.27, lat: 54.68, course: 90 })
  })

  it('a device that has only ever reported invalid fixes has nothing to centre on', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { fixValid: false, satellites: 0, lat: 0, lon: 0 }))
    store.select('1')
    expect(store.selectedFix()).toBeNull()
    store.select(null)
    expect(store.selectedFix()).toBeNull()
  })

  it("a moment we hold no position for is 'unknown', which is NOT back-to-live", () => {
    // Conflating the two flew the map to the vehicle's present position while the readout named a
    // moment 24 hours ago — on every press of "-24 h".
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { lat: 54.68, lon: 25.27 }))
    store.select('1')
    let frame: MapFrame | null = null
    store.onMapFrame((f) => { frame = f })
    store.setScrub('unknown')
    expect((frame as unknown as MapFrame).scrub).toBe('unknown')
    store.setScrub(null)
    expect((frame as unknown as MapFrame).scrub).toBeNull()
  })

  it('scrubbing reuses the built collections instead of rebuilding every marker', () => {
    // A slider drag fires dozens of times a second and replay ~11×/s; rebuilding the fleet and up
    // to 3600 trail vertices per tick is exactly the per-message work the 1 Hz flush exists to avoid.
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { lat: 54.68, lon: 25.27 }))
    const first = frameOf(store)
    let latest: MapFrame = first
    store.onMapFrame((f) => { latest = f })
    store.setScrub({ lat: 54.5, lon: 25.1, course: null })
    expect(latest.devices).toBe(first.devices) // same object — not rebuilt
    expect(latest.scrub).toEqual({ lat: 54.5, lon: 25.1, course: null })
    // …but a real position change still rebuilds
    store.ingest(ev('1', T0 + 1_000, { lat: 55, lon: 24 }))
    store.flush()
    expect(latest.devices).not.toBe(first.devices)
  })

  it('a drag that resolves to the same position does not re-emit — identity is not enough', () => {
    // The scrubber builds a fresh object per slider step, so hundreds of consecutive steps over a
    // parked vehicle produce hundreds of structurally identical, referentially distinct points.
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { lat: 54.68, lon: 25.27 }))
    store.flush(true)
    let frames = 0
    store.onMapFrame(() => { frames += 1 })
    store.setScrub({ lat: 54.5, lon: 25.1, course: 12 })
    frames = 0
    store.setScrub({ lat: 54.5, lon: 25.1, course: 12 })
    expect(frames).toBe(0)
    store.setScrub({ lat: 54.5, lon: 25.1, course: 13 })
    expect(frames).toBe(1)
  })

  it('a device retired in another tab clears the scrub with the selection', () => {
    // retain() was the one deselecting path that forgot: the scrub survived, and a surviving scrub
    // makes the follow branch unreachable — turning Follow on then silently did nothing.
    let now = T0
    const store = makeStore(() => now)
    store.ingest(ev('1', T0, { lat: 54.68, lon: 25.27 }))
    store.flush(true)
    store.select('1')
    let frame: MapFrame | null = null
    store.onMapFrame((f) => { frame = f })
    store.setScrub({ lat: 54.5, lon: 25.1, course: null })
    // a device still streaming inside ONLINE_MS is kept whatever the registry says — the WS stream
    // is ground truth for presence — so age it past that first
    now = T0 + 200_000
    store.retain([]) // the registry no longer lists it
    expect((frame as unknown as MapFrame).scrub).toBeNull()
    expect(store.getSnapshot().selectedId).toBeNull()
  })

  it('evicting the selected device clears its scrub with the selection', () => {
    // The state "selected but no longer in byId" is now unreachable — both removal paths deselect —
    // and that is the claim worth pinning: a scrub must never outlive the vehicle it was taken from.
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { lat: 54.68, lon: 25.27 }))
    store.flush(true)
    store.select('1')
    let frame: MapFrame | null = null
    store.onMapFrame((f) => { frame = f })
    store.setScrub({ lat: 54.5, lon: 25.1, course: null })
    expect(store.evict('1')).toBe(true)
    expect((frame as unknown as MapFrame).scrub).toBeNull()
    expect(store.getSnapshot().selectedId).toBeNull()
    // evicting something that was never there changes nothing and says so
    expect(store.evict('nope')).toBe(false)
  })

  it('setting the same scrub twice does not re-emit', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { lat: 54.68, lon: 25.27 }))
    store.flush(true)
    let frames = 0
    store.onMapFrame(() => { frames += 1 })
    frames = 0
    store.setScrub(null) // already null
    expect(frames).toBe(0)
  })
})

/**
 * The ghost marker at the scrubbed moment.
 *
 * The founder's report: dragging the timeline panned the map and drew nothing, because every marker
 * on the map is built from the LIVE frame. This is what fills that gap — and it must not fill it
 * with a claim the record does not support.
 */
describe('the scrubbed moment, drawn', () => {
  it('live and unknown draw nothing at all', () => {
    // 'unknown' means "we hold no position for that moment" — the camera holds and the map stays
    // honest by showing nothing, rather than a ghost somewhere plausible.
    expect(scrubFeatures(null).features).toEqual([])
    expect(scrubFeatures('unknown').features).toEqual([])
  })

  it('places the ghost exactly where the record was', () => {
    const fc = scrubFeatures({ lon: 25.27, lat: 54.68, course: 90 })
    expect((fc.features[0]!.geometry as GeoJSON.Point).coordinates).toEqual([25.27, 54.68])
    expect(fc.features[0]!.properties).toEqual({ course: 90, hasCourse: true })
  })

  it('a record with no heading gets no arrow — not an arrow pointing north', () => {
    // The manufactured-heading defect, one layer along: `?? 0` plus `!== null` would have disagreed
    // about what "missing" means and drawn due north for a record that carried nothing.
    expect(scrubFeatures({ lon: 25.27, lat: 54.68, course: null }).features[0]!.properties)
      .toEqual({ course: 0, hasCourse: false })
  })

  it('due north IS a heading', () => {
    // 0 is a real course. A falsy check here would silently hide the arrow for every vehicle
    // driving north.
    expect(scrubFeatures({ lon: 25.27, lat: 54.68, course: 0 }).features[0]!.properties)
      .toEqual({ course: 0, hasCourse: true })
  })

  it('two moments at one coordinate are two different ghosts', () => {
    // A parked vehicle repeats its coordinate bit-for-bit while the angle moves, so the drawing
    // must be a function of the whole value and not of the position. This pins the FEATURE side of
    // that; the map's decision to redraw is inline in its effect and out of reach from here — the
    // branch's honest gap, stated in the commit rather than papered over with a test that would
    // pass either way.
    const a = scrubFeatures({ lon: 25.1, lat: 54.5, course: 90 })
    const b = scrubFeatures({ lon: 25.1, lat: 54.5, course: 180 })
    expect(a.features[0]!.properties).not.toEqual(b.features[0]!.properties)
    expect(b.features[0]!.properties).toMatchObject({ course: 180, hasCourse: true })
  })
})

describe('LiveStore', () => {
  it('max-wins: an older fixTimeMs never regresses the marker (server parity)', () => {
    const store = makeStore(() => T0 + 10_000)
    store.ingest(ev('1', T0 + 5_000, { speed: 50 }))
    store.ingest(ev('1', T0 + 1_000, { speed: 99 })) // buffered flood replay
    store.flush()
    expect(store.getSnapshot().devices[0]!.ev.speed).toBe(50)
  })

  it('batches: N ingests between flushes → one snapshot rebuild, sorted numerically', () => {
    const store = makeStore(() => T0)
    let notifications = 0
    store.subscribe(() => notifications++)
    store.ingest(ev('10', T0))
    store.ingest(ev('2', T0))
    store.ingest(ev('1', T0))
    expect(notifications).toBe(0) // nothing emitted before flush
    store.flush()
    expect(notifications).toBe(1)
    expect(store.getSnapshot().devices.map((d) => d.ev.deviceId)).toEqual(['1', '2', '10'])
  })

  it('status thresholds: online ≤3 min, stale ≤10 min, offline beyond', () => {
    let now = T0
    const store = makeStore(() => now)
    store.ingest(ev('1', T0))
    store.flush()
    expect(store.getSnapshot().devices[0]!.status).toBe('online')
    // a Teltonika device BATCHES: it records on distance/angle and sends on a separate send period,
    // 120 s by default on the FT platform. At the old 60 s window a device driving perfectly —
    // recording every 1-5 s, as an FTC887 was measured doing — flapped online/stale all trip, so
    // the dot reported our impatience rather than the vehicle. 120 s must still read online.
    now = T0 + 121_000
    store.flush()
    expect(store.getSnapshot().devices[0]!.status, 'one default send period is not "stale"').toBe('online')
    now = T0 + 181_000
    store.flush()
    expect(store.getSnapshot().devices[0]!.status).toBe('stale')
    now = T0 + 601_000
    store.flush()
    expect(store.getSnapshot().devices[0]!.status).toBe('offline')
  })

  it('stable refs: unchanged devices keep identity across flushes (memo rows skip render)', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    store.ingest(ev('2', T0))
    store.flush()
    const [a1, b1] = store.getSnapshot().devices
    store.ingest(ev('2', T0 + 1_000))
    store.flush()
    const [a2, b2] = store.getSnapshot().devices
    expect(a2).toBe(a1) // untouched device: same object
    expect(b2).not.toBe(b1)
  })

  it('skips flush entirely when nothing changed', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    store.flush()
    const snap = store.getSnapshot()
    store.flush()
    expect(store.getSnapshot()).toBe(snap)
  })

  it('trail: accumulates only for the selected device while enabled; capped ring; reset on reselect', () => {
    const store = makeStore(() => T0)
    let frame: MapFrame | null = null
    store.onMapFrame((f) => (frame = f))
    store.ingest(ev('1', T0))
    store.flush()
    store.select('1')
    store.setTrail(true)
    store.ingest(ev('1', T0 + 1_000, { lon: 25.28 }))
    store.ingest(ev('2', T0 + 1_000)) // other device — never in the trail
    store.ingest(ev('1', T0 + 2_000, { lon: 25.29 }))
    store.flush()
    const line = frame!.trail.features[0]
    expect(line).toBeDefined()
    expect((line!.geometry as GeoJSON.LineString).coordinates).toHaveLength(2)
    store.select(null) // deselect clears
    store.select('1')
    store.flush(true)
    expect(frame!.trail.features).toHaveLength(0)
  })

  it('ingestRaw drops garbage and schema-drifted frames', () => {
    const store = makeStore(() => T0)
    store.ingestRaw('{not json')
    store.ingestRaw(JSON.stringify({ deviceId: '1' })) // missing fields
    store.ingestRaw(JSON.stringify({ ...ev('1', T0), extraField: 1 })) // strict schema
    store.flush()
    expect(store.getSnapshot().devices).toHaveLength(0)
  })

  it('trail segments: invalid points split the line into solid runs + a dashed gap (I5, E02-7)', () => {
    // speed 40: these fixtures model a DRIVE, and every production caller sets the field. While it
    // was omitted the gate below could never fire here, so the suite guarding I5 was blind to it.
    const pt = (lon: number, lat: number, fixValid: boolean): TrailPoint => ({ lon, lat, fixValid, fixTimeMs: T0, speed: 40, movement: true })
    const features = buildTrailFeatures([
      pt(25.27, 54.68, true),
      pt(25.272, 54.681, true),
      pt(25.272, 54.681, false), // §3.4: repeats last valid coords while no fix
      pt(25.272, 54.681, false),
      pt(25.276, 54.683, true),
      pt(25.278, 54.684, true),
    ])
    const solid = features.filter((f) => f.properties!['gap'] === false)
    const gaps = features.filter((f) => f.properties!['gap'] === true)
    expect(solid).toHaveLength(2)
    expect(gaps).toHaveLength(1)
    const gapLine = gaps[0]!.geometry as GeoJSON.LineString
    expect(gapLine.coordinates).toEqual([[25.272, 54.681], [25.276, 54.683]]) // last valid → first valid after the stretch
    const [runA, runB] = solid.map((f) => (f.geometry as GeoJSON.LineString).coordinates)
    expect(runA).toHaveLength(2)
    expect(runB).toHaveLength(2)
  })

  it('trail matches the invalidFix scenario shape: every 3rd point invalid → 2-point solid runs joined by dashes', () => {
    const pt = (lon: number, fixValid: boolean): TrailPoint => ({ lon, lat: 54.68, fixValid, fixTimeMs: T0, speed: 40, movement: true })
    // v,v,i,v,v,i,v,v — tools/simulator invalidFix emits exactly this cadence
    const features = buildTrailFeatures([
      pt(25.27, true), pt(25.271, true), pt(25.271, false),
      pt(25.273, true), pt(25.274, true), pt(25.274, false),
      pt(25.276, true), pt(25.277, true),
    ])
    expect(features.filter((f) => f.properties!['gap'] === false)).toHaveLength(3)
    expect(features.filter((f) => f.properties!['gap'] === true)).toHaveLength(2)
  })

  it('trail edge cases: all-valid → one solid line, no gap; leading/trailing invalid → no dangling connectors', () => {
    const pt = (lon: number, fixValid: boolean): TrailPoint => ({ lon, lat: 54.68, fixValid, fixTimeMs: T0, speed: 40, movement: true })
    const allValid = buildTrailFeatures([pt(25.27, true), pt(25.272, true), pt(25.274, true)])
    expect(allValid).toHaveLength(1)
    expect(allValid[0]!.properties!['gap']).toBe(false)

    const edges = buildTrailFeatures([pt(25.26, false), pt(25.27, true), pt(25.272, true), pt(25.274, false)])
    expect(edges).toHaveLength(1) // only the solid middle run — nothing dangles
    expect(edges[0]!.properties!['gap']).toBe(false)

    // device resumes exactly where it lost the fix → no zero-length gap feature
    const resumeInPlace = buildTrailFeatures([pt(25.27, true), pt(25.272, true), pt(25.272, false), pt(25.272, true), pt(25.274, true)])
    expect(resumeInPlace.filter((f) => f.properties!['gap'] === true)).toHaveLength(0)
    expect(resumeInPlace.filter((f) => f.properties!['gap'] === false)).toHaveLength(2)
  })

  it('evict: removes a retired device from the snapshot and clears it if selected', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    store.ingest(ev('2', T0))
    store.flush()
    store.select('2')
    expect(store.evict('2')).toBe(true)
    expect(store.getSnapshot().devices.map((d) => d.ev.deviceId)).toEqual(['1'])
    expect(store.getSnapshot().selectedId).toBeNull() // selection cleared with the evicted device
    expect(store.evict('nope')).toBe(false) // unknown id: no-op
  })

  it('evict: an evicted device does not reappear from a later stale flush', () => {
    let now = T0
    const store = makeStore(() => now)
    store.ingest(ev('9', T0))
    store.flush()
    store.evict('9')
    now = T0 + 700_000 // time passes — flush re-evaluates statuses
    store.flush()
    expect(store.getSnapshot().devices).toHaveLength(0)
  })

  it('retain: reconciles the live set to the authoritative active registry', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    store.ingest(ev('2', T0))
    store.ingest(ev('3', T0 - 700_000)) // device 3 stale (offline) — safe to evict when absent
    store.flush()
    store.select('3')
    store.retain(['1', '2']) // device 3 retired/removed in the registry
    expect(store.getSnapshot().devices.map((d) => d.ev.deviceId)).toEqual(['1', '2'])
    expect(store.getSnapshot().selectedId).toBeNull()
  })

  it('retain: keeps a device still streaming fresh fixes even if absent from the registry cache', () => {
    // a device provisioned in another tab streams before the ['devices'] cache refetches — the WS
    // stream is ground truth for presence, so retain must not evict it (review LOW)
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    store.ingest(ev('2', T0)) // fresh, but not yet in the registry list
    store.flush()
    store.retain(['1'])
    expect(store.getSnapshot().devices.map((d) => d.ev.deviceId)).toEqual(['1', '2'])
  })

  it('retain: is a no-op (stable snapshot) when every live device is still present', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    store.ingest(ev('2', T0))
    store.flush()
    const snap = store.getSnapshot()
    store.retain(['1', '2', '5']) // superset — nothing to drop
    expect(store.getSnapshot()).toBe(snap)
  })

  it('map frame carries selection + follow for the LiveMap sink', () => {
    const store = makeStore(() => T0)
    let frame: MapFrame | null = null
    store.onMapFrame((f) => (frame = f))
    store.ingest(ev('7', T0))
    store.flush()
    store.select('7')
    store.setFollow(true)
    expect(frame!.selected?.deviceId).toBe('7')
    expect(frame!.follow).toBe(true)
    // Selection travels on the FRAME, not on every marker: the halo is a `setFilter` against
    // `frame.selected`, and stamping a per-feature flag meant each row click invalidated the whole
    // marker collection to change a property nothing read.
    expect(frame!.devices.features[0]!.properties).not.toHaveProperty('selected')
  })
})

/**
 * Scrubbing the 24-hour timeline.
 *
 * The property that matters: examining one vehicle's past must not stop the map answering "where is
 * everyone now". The scrub point rides ALONGSIDE the live frame rather than replacing it.
 */
describe('the timeline scrub point', () => {
  const frameOf = (store: LiveStore): MapFrame => {
    let out: MapFrame | null = null
    store.onMapFrame((f) => { out = f })
    store.flush(true)
    return out!
  }

  it('is null while the map is live', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    expect(frameOf(store).scrub).toBeNull()
  })

  it('carries the historic point without disturbing the live markers', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0, { lat: 54.7, lon: 25.3 }))
    store.ingest(ev('2', T0, { lat: 54.9, lon: 23.9 }))
    let frame: MapFrame | null = null
    store.onMapFrame((f) => { frame = f })
    store.flush(true)
    store.setScrub({ lat: 55.5, lon: 21.1, course: 90 })
    expect(frame!.scrub).toEqual({ lat: 55.5, lon: 21.1, course: 90 })
    // …and the fleet is still exactly where it is now
    expect(frame!.devices.features).toHaveLength(2)
    expect((frame!.devices.features[0]!.geometry as GeoJSON.Point).coordinates).toEqual([25.3, 54.7])
  })

  it('dies with the selection — it belongs to ONE vehicle', () => {
    /**
     * It used to survive: closing the inspector unmounted the Timeline without its own onClose, so
     * the point stayed set and every 1 Hz frame re-centred the map on another vehicle's past —
     * forever, unpannable, with nothing on screen saying why.
     */
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    store.ingest(ev('2', T0))
    let frame: MapFrame | null = null
    store.onMapFrame((f) => { frame = f })
    store.select('1')
    store.setScrub({ lat: 55.5, lon: 21.1, course: null })
    expect(frame!.scrub).not.toBeNull()

    store.select('2') // another vehicle
    expect(frame!.scrub).toBeNull()

    store.setScrub({ lat: 55.5, lon: 21.1, course: null })
    store.select(null) // deselect entirely
    expect(frame!.scrub).toBeNull()
  })

  it('…and with the device itself', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    let frame: MapFrame | null = null
    store.onMapFrame((f) => { frame = f })
    store.select('1')
    store.setScrub({ lat: 55.5, lon: 21.1, course: null })
    store.evict('1')
    expect(frame!.scrub).toBeNull()
  })

  it('returns to live on null', () => {
    const store = makeStore(() => T0)
    store.ingest(ev('1', T0))
    let frame: MapFrame | null = null
    store.onMapFrame((f) => { frame = f })
    store.setScrub({ lat: 55.5, lon: 21.1, course: null })
    store.setScrub(null)
    expect(frame!.scrub).toBeNull()
  })
})

/**
 * A parked vehicle's GPS jitter is not a path.
 *
 * Founder-reported from the live map: an FTC887 stood in a car park all evening and the 24-hour
 * track drew a tangle across it. Measured on that device — 35 records over six hours, every one
 * reporting speed 0, 91 m of accumulated point-to-point distance, largest single step 11.9 m. Every
 * record carried the fact that it had not moved; the map drew the movement anyway.
 */
describe('stationary jitter', () => {
  const at = (lat: number, lon: number, speed: number | null, fixValid = true): TrailPoint =>
    ({ lat, lon, speed, fixValid, fixTimeMs: 0, movement: null })
  /** ≈11 m north — the largest jitter step measured on the real device. */
  const JITTER = 0.0001

  it('collapses a parked run to the place it was parked', () => {
    const points = [at(54.68, 25.27, 0), at(54.68 + JITTER, 25.27, 0), at(54.68, 25.27 + JITTER, 0)]
    expect(dropStationaryJitter(points)).toHaveLength(1)
  })

  it('a device that never moved draws no line at all, which is the truth', () => {
    // Not a defect: a run of one point has no line to draw, because no journey happened. The
    // vehicle is still on the map — the live marker never came from the trail — and the scrubber
    // still reports how many points arrived.
    const parked = Array.from({ length: 200 }, (_, i) => at(54.68 + (i % 3) * JITTER, 25.27, 0))
    expect(dropStationaryJitter(parked)).toHaveLength(1)
    expect(buildTrailFeatures(parked)).toHaveLength(0)
  })

  it('a COLLAPSED run still supplies the dashed connector (why first-only is enough)', () => {
    // The premise that once justified holding the last point back, checked rather than assumed:
    // buildTrailFeatures joins prev[last] → current[0] whatever the run lengths. Run A has three
    // records here so the filter genuinely collapses it — with one record the test would pass even
    // if the filter did nothing.
    const points = [
      at(54.68, 25.27, 0), at(54.68 + JITTER, 25.27, 0), at(54.68, 25.27 + JITTER, 0), // run A → 1
      at(54.68, 25.27, 0, false),             // no fix
      at(54.6845, 25.27, 0),                  // parked run B, 500 m away — a tow
    ]
    const gaps = buildTrailFeatures(points).filter((f) => f.properties!['gap'] === true)
    expect(gaps).toHaveLength(1)
    expect((gaps[0]!.geometry as GeoJSON.LineString).coordinates).toEqual([[25.27, 54.68], [25.27, 54.6845]])
  })

  it('a reported zero decides alone — movement true does not override it', () => {
    // Measured on one FTC887 over 24 h: 383 records reporting speed 0 AND movement true shared 54 m
    // between them — the most static bucket of the whole day. AVL 240's SOURCE is a device setting,
    // so "movement true" is not a promise of displacement; that observation is the whole argument,
    // and it is enough to say a reported zero must not be overridden.
    const idling = [at(54.68, 25.27, 0), { ...at(54.68 + JITTER, 25.27, 0), movement: true }]
    expect(dropStationaryJitter(idling)).toHaveLength(1)
  })

  it('where speed is unreported, movement is the only statement we have', () => {
    const silent = (mv: boolean | null) => [
      { ...at(54.68, 25.27, null), movement: mv },
      { ...at(54.68 + JITTER, 25.27, null), movement: mv },
      { ...at(54.68, 25.27 + JITTER, null), movement: mv },
    ]
    expect(dropStationaryJitter(silent(false))).toHaveLength(1) // "I am not moving" — gated
    expect(dropStationaryJitter(silent(null))).toHaveLength(3)  // no statement — nothing is dropped
    expect(dropStationaryJitter(silent(true))).toHaveLength(3)
  })

  it('a stop INSIDE a drive costs the run no vertex, and never splits it', () => {
    // the one place the gate and I5 segmentation interact: a stationary record in the middle of a
    // valid run. It must not become a run boundary — only an invalid fix does that.
    const points = [
      at(54.68, 25.27, 40), at(54.681, 25.27, 40),
      at(54.681 + JITTER, 25.27, 0), at(54.681, 25.27 + JITTER, 0), // waiting at a light
      at(54.683, 25.27, 40),
    ]
    const features = buildTrailFeatures(points)
    expect(features).toHaveLength(1) // still ONE solid run, no gap
    expect((features[0]!.geometry as GeoJSON.LineString).coordinates).toHaveLength(3)
  })

  it('measures metres across the antimeridian, not 23 000 km', () => {
    // without wrapping the longitude delta the gate silently never fires anywhere near ±180.
    // Both sides of the gate, so a future change to its width cannot quietly invert this.
    const inside = [at(0, 179.99995, 0), at(0, -179.99995, 0)] // ≈11 m apart
    expect(dropStationaryJitter(inside)).toHaveLength(1)
    const outside = [at(0, 179.9995, 0), at(0, -179.9995, 0)] // ≈111 m apart — a real move
    expect(dropStationaryJitter(outside)).toHaveLength(2)
  })

  it('an asset that works inside the gate collapses — the cost, recorded not rediscovered', () => {
    // A yard tracker shuttling 15 m at reported speed 0 loses its shift to one point. GNSS cannot
    // honestly separate that from jitter; the previous rule tried to, by exempting movement=true,
    // and that re-admitted the purest jitter of the day instead.
    const yard = [at(54.68, 25.27, 0), at(54.6801, 25.27, 0), at(54.68, 25.27, 0)] // ~11 m hops
    expect(dropStationaryJitter(yard)).toHaveLength(1)
  })

  it('the anchor SURVIVES a no-fix stretch — otherwise the scribble comes back in dashes', () => {
    // The case that separates reset from no-reset: the record after the outage is a JITTER distance
    // from the one before it. A parked car under a patchy sky reports valid, valid, no-fix in a
    // loop, so resetting the anchor kept every third record and drew 233 m of dashes for a vehicle
    // that never moved — an invalid record deciding which VALID vertices reach the map (rule 6).
    const parked: TrailPoint[] = []
    for (let i = 0; i < 30; i++) {
      parked.push(at(54.68 + (i % 3) * JITTER, 25.27, 0), at(54.68, 25.27 + JITTER, 0), at(54.68, 25.27, 0, false))
    }
    expect(dropStationaryJitter(parked).filter((p) => p.fixValid)).toHaveLength(1)
    expect(buildTrailFeatures(parked)).toHaveLength(0)
  })

  it('…but a vehicle towed during the outage still draws both seams and the connector', () => {
    // the dashed connector marks WHERE the fix was lost; gating either end would move it by up to
    // the gate width, and the operator reads that line as evidence
    // The parked stretch before the outage genuinely collapses, so the connector's NEAR end is the
    // anchor the gate chose rather than the last record that happened to arrive — this is what the
    // gate costs, stated. The far end is the tow, which clears the gate on its own merits.
    const points = [
      at(54.68, 25.27, 0), at(54.68 + JITTER, 25.27, 0), at(54.68, 25.27 + JITTER, 0),
      at(54.68, 25.27, 0, false),
      at(54.6845, 25.27, 0), at(54.6845 + JITTER, 25.27, 0),
    ]
    expect(dropStationaryJitter(points).filter((p) => !p.fixValid)).toHaveLength(1)
    const gaps = buildTrailFeatures(points).filter((f) => f.properties!['gap'] === true)
    expect(gaps).toHaveLength(1)
    expect((gaps[0]!.geometry as GeoJSON.LineString).coordinates).toEqual([
      [25.27, 54.68],   // the anchor, not the last pre-gap record
      [25.27, 54.6845], // the tow
    ])
  })

  it('never touches a record the device says is moving', () => {
    // the gate acts only on the device's OWN claim of standing still; a moving record at the same
    // coordinate is a fact about a vehicle crawling, and crawling is not jitter
    const points = [at(54.68, 25.27, 0), at(54.68 + JITTER, 25.27, 3), at(54.68, 25.27 + JITTER, 12)]
    expect(dropStationaryJitter(points)).toHaveLength(3)
  })

  it('a null speed is unreported, not zero — nothing is dropped', () => {
    const points = [at(54.68, 25.27, null), at(54.68 + JITTER, 25.27, null)]
    expect(dropStationaryJitter(points)).toHaveLength(2)
  })

  it('a vehicle moved while stationary — towed, or pushed — still draws the move', () => {
    // 500 m away with the engine off is not jitter, and refusing to draw it would hide a theft
    const points = [at(54.68, 25.27, 0), at(54.6845, 25.27, 0)]
    expect(dropStationaryJitter(points)).toHaveLength(2)
  })

  it('keeps invalid fixes, because they are what separates the runs', () => {
    // I5: a no-fix stretch becomes a dashed connector. Dropping one would silently merge two runs
    // into a solid line the vehicle never drove.
    const points = [at(54.68, 25.27, 0), at(0, 0, 0, false), at(54.7, 25.3, 30)]
    expect(dropStationaryJitter(points).filter((p) => !p.fixValid)).toHaveLength(1)
  })

  it('the drawn line loses the scribble but keeps the drive', () => {
    // end to end through the thing that actually paints: three parked records then a real drive
    const points = [
      at(54.68, 25.27, 0), at(54.68 + JITTER, 25.27, 0), at(54.68, 25.27 + JITTER, 0),
      at(54.69, 25.28, 40), at(54.70, 25.29, 45),
    ]
    const coords = (buildTrailFeatures(points)[0]!.geometry as GeoJSON.LineString).coordinates
    expect(coords).toHaveLength(3) // where it was parked, then the two driven points
  })
})
