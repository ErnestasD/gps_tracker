import type { NormalizedRecord } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { GeofenceEngine, type GeofenceDef } from '../src/geofence/engine.js'
import { pointInPolygon, type GeoPolygon } from '../src/geofence/point.js'

const square: GeoPolygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }
const withHole: GeoPolygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]]] }
const GF: GeofenceDef = { id: 'gf1', name: 'Depot', geometry: square }
const gfFor = () => [GF]

const T0 = 1_751_600_000_000
const rec = (tSec: number, lon: number, lat: number, fixValid = true): NormalizedRecord => ({
  deviceId: 42n, fixTime: new Date(T0 + tSec * 1000), serverTime: new Date(T0 + tSec * 1000), lat, lon,
  altitude: null, speed: 30, course: null, satellites: fixValid ? 9 : 0, fixValid,
  ignition: true, movement: true, odometerM: null, priority: 0, recHash: BigInt(tSec), attrs: {},
})

describe('E05-2 pointInPolygon', () => {
  it('inside / outside / hole', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true)
    expect(pointInPolygon(15, 5, square)).toBe(false)
    expect(pointInPolygon(5, 5, withHole)).toBe(false) // in the hole ⇒ outside
    expect(pointInPolygon(1, 1, withHole)).toBe(true) // between outer and hole
    expect(pointInPolygon(8, 8, withHole)).toBe(true)
  })
})

describe('E05-2 GeofenceEngine (hysteresis)', () => {
  it('enter needs 2 consecutive inside; exit needs 2 consecutive outside', () => {
    const e = new GeofenceEngine()
    expect(e.feed([rec(0, 5, 5)], gfFor)).toHaveLength(0) // 1 inside — not yet
    const ev = e.feed([rec(10, 5, 5)], gfFor) // 2nd consecutive inside → enter
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ geofenceId: 'gf1', type: 'enter', deviceId: 42n })
    expect(e.feed([rec(20, 50, 50)], gfFor)).toHaveLength(0) // 1 outside — not yet
    const ex = e.feed([rec(30, 50, 50)], gfFor) // 2nd outside → exit
    expect(ex).toHaveLength(1)
    expect(ex[0]!.type).toBe('exit')
  })

  it('boundary jitter (in/out/in/out) never confirms a transition', () => {
    const e = new GeofenceEngine()
    const ev = e.feed([rec(0, 5, 5), rec(10, 50, 50), rec(20, 5, 5), rec(30, 50, 50)], gfFor)
    expect(ev).toHaveLength(0) // never 2 consecutive on the new side
  })

  it('I5: an invalid fix inside the fence never counts toward a transition', () => {
    const e = new GeofenceEngine()
    // one valid inside, then an invalid inside — must NOT reach 2 consecutive valid
    expect(e.feed([rec(0, 5, 5), rec(10, 5, 5, false)], gfFor)).toHaveLength(0)
    // a second VALID inside now confirms
    expect(e.feed([rec(20, 5, 5)], gfFor)).toHaveLength(1)
  })

  it('out-of-order records are dropped (I2)', () => {
    const e = new GeofenceEngine()
    e.feed([rec(100, 5, 5), rec(110, 5, 5)], gfFor) // enter at t=110
    const late = e.feed([rec(50, 50, 50), rec(60, 50, 50)], gfFor) // older than lastSeen → dropped
    expect(late).toHaveLength(0) // no spurious exit from stale data
  })

  it('a single outside reading then back inside does NOT exit (hysteresis asymmetry)', () => {
    const e = new GeofenceEngine()
    e.feed([rec(0, 5, 5), rec(10, 5, 5)], gfFor) // enter confirmed
    const ev = e.feed([rec(20, 50, 50), rec(30, 5, 5)], gfFor) // one out, then back in
    expect(ev).toHaveLength(0) // stays inside, no exit fired
  })

  it('warm-start (insideFor): a device already inside on restart does not re-fire enter', () => {
    const e = new GeofenceEngine()
    const inside = () => true // durable state says the device is already inside gf1
    // two inside readings must NOT emit an enter (it never left)
    expect(e.feed([rec(0, 5, 5), rec(10, 5, 5)], gfFor, inside)).toHaveLength(0)
    // leaving now correctly fires exit after 2 outside
    expect(e.feed([rec(20, 50, 50)], gfFor, inside)).toHaveLength(0)
    expect(e.feed([rec(30, 50, 50)], gfFor, inside)[0]!.type).toBe('exit')
  })

  it('MED-2: state for a geofence dropped from the set is pruned (a later re-add starts fresh)', () => {
    const e = new GeofenceEngine()
    e.feed([rec(0, 5, 5), rec(10, 5, 5)], gfFor) // enter gf1
    e.feed([rec(20, 5, 5)], () => []) // gf1 no longer applicable → prune its state
    // gf1 re-applies; without warm-start the pruned pair defaults to outside → needs 2 to re-enter
    expect(e.feed([rec(30, 5, 5)], gfFor)).toHaveLength(0) // 1 inside — not yet (proves state was pruned)
    expect(e.feed([rec(40, 5, 5)], gfFor)).toHaveLength(1) // 2nd → re-enter
  })

  it('per-device + per-geofence state is independent', () => {
    const gf2: GeofenceDef = { id: 'gf2', name: 'Yard', geometry: { type: 'Polygon', coordinates: [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]] } }
    const e = new GeofenceEngine()
    const recD = (d: bigint, tSec: number, lon: number, lat: number): NormalizedRecord => ({ ...rec(tSec, lon, lat), deviceId: d })
    // device 1 enters gf1; device 2 enters gf2 — independently
    const ev = e.feed([recD(1n, 0, 5, 5), recD(2n, 0, 25, 25), recD(1n, 10, 5, 5), recD(2n, 10, 25, 25)], () => [GF, gf2])
    expect(ev.filter((t) => t.deviceId === 1n && t.geofenceId === 'gf1' && t.type === 'enter')).toHaveLength(1)
    expect(ev.filter((t) => t.deviceId === 2n && t.geofenceId === 'gf2' && t.type === 'enter')).toHaveLength(1)
  })
})
