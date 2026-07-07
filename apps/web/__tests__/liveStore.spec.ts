import type { LiveEvent } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { LiveStore, buildTrailFeatures, type MapFrame, type TrailPoint } from '../src/lib/liveStore.js'

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

  it('status thresholds: online ≤60 s, stale ≤10 min, offline beyond', () => {
    let now = T0
    const store = makeStore(() => now)
    store.ingest(ev('1', T0))
    store.flush()
    expect(store.getSnapshot().devices[0]!.status).toBe('online')
    now = T0 + 61_000
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
    const pt = (lon: number, lat: number, fixValid: boolean): TrailPoint => ({ lon, lat, fixValid, fixTimeMs: T0 })
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

  it('trail edge cases: all-valid → one solid line, no gap; leading/trailing invalid → no dangling connectors', () => {
    const pt = (lon: number, fixValid: boolean): TrailPoint => ({ lon, lat: 54.68, fixValid, fixTimeMs: T0 })
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
    expect(frame!.devices.features[0]!.properties!['selected']).toBe(true)
  })
})
