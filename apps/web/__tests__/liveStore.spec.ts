import type { LiveEvent } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { LiveStore, type MapFrame } from '../src/lib/liveStore.js'

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
