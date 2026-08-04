import type { NormalizedRecord } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { GeofenceEngine, type GeofenceDef } from '../src/geofence/engine.js'
import { bboxOf, pointInPolygon, type GeoPolygon } from '../src/geofence/point.js'

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

  it('rollback re-fires a crossing whose durable persist FAILED (audit C1)', () => {
    const e = new GeofenceEngine()
    e.feed([rec(0, 5, 5)], gfFor)
    const ev = e.feed([rec(10, 5, 5)], gfFor) // enter confirmed + emitted
    expect(ev).toHaveLength(1)
    // the worker's persist() threw → roll the in-memory side-flip back
    e.rollback(ev)
    // the device is STILL inside; the next two fixes re-confirm the enter (would be LOST without rollback)
    expect(e.feed([rec(20, 5, 5)], gfFor)).toHaveLength(0) // 1st inside after rollback
    const re = e.feed([rec(30, 5, 5)], gfFor) // 2nd → RE-enter
    expect(re).toHaveLength(1)
    expect(re[0]).toMatchObject({ geofenceId: 'gf1', type: 'enter' })
  })

  it('WITHOUT rollback a failed-persist crossing is lost forever (proves the fix matters)', () => {
    const e = new GeofenceEngine()
    e.feed([rec(0, 5, 5)], gfFor)
    expect(e.feed([rec(10, 5, 5)], gfFor)).toHaveLength(1) // enter emitted but "persist failed"
    // no rollback: the engine believes it is inside, so subsequent inside fixes never re-fire
    expect(e.feed([rec(20, 5, 5)], gfFor)).toHaveLength(0)
    expect(e.feed([rec(30, 5, 5)], gfFor)).toHaveLength(0) // lost
  })

  it('rollback of enter+exit in ONE batch restores the true PRE-BATCH side (review HIGH)', () => {
    const e = new GeofenceEngine()
    // pair starts OUTSIDE; one batch does 2-inside (enter) then 2-outside (exit)
    const evs = e.feed([rec(0, 5, 5), rec(10, 5, 5), rec(20, 50, 50), rec(30, 50, 50)], gfFor)
    expect(evs.map((t) => t.type)).toEqual(['enter', 'exit'])
    // both writes failed → rollback must restore pre-batch side = OUTSIDE (not the last transition's)
    e.rollback(evs)
    // proof: the device returns inside → a fresh ENTER fires (a forward rollback would leave the pair
    // "inside" and SUPPRESS this, losing the enter — the exact bug the reverse iteration fixes)
    expect(e.feed([rec(40, 5, 5)], gfFor)).toHaveLength(0) // 1st inside
    const re = e.feed([rec(50, 5, 5)], gfFor) // 2nd → enter
    expect(re).toHaveLength(1)
    expect(re[0]).toMatchObject({ type: 'enter' })
  })

  it('rollback restores the exit side too (device still outside re-fires the exit)', () => {
    const e = new GeofenceEngine()
    // get it confirmed-inside first (persist assumed OK here — warm-start via insideFor)
    const inside = () => true
    e.feed([rec(0, 5, 5)], gfFor, inside) // already inside per warm-start → no enter
    e.feed([rec(10, 50, 50)], gfFor) // 1st outside
    const ex = e.feed([rec(20, 50, 50)], gfFor) // 2nd outside → exit
    expect(ex).toHaveLength(1)
    e.rollback(ex) // exit persist failed → back to inside
    expect(e.feed([rec(30, 50, 50)], gfFor)).toHaveLength(0) // 1st outside again
    const re = e.feed([rec(40, 50, 50)], gfFor) // 2nd → re-exit
    expect(re[0]).toMatchObject({ type: 'exit' })
  })
})

describe('E05-2 GeofenceEngine hot-path cost (audit high)', () => {
  it('prune() touches only the fed device, not the GLOBAL pair map', () => {
    // REGRESSION: prune() ran once per RECORD and iterated `this.state.keys()` — every
    // (device × fence) pair the process had ever seen. The engine is a process-wide singleton
    // shared by all 16 shard consumers, so `state` grows with the whole fleet, and a 200-record
    // batch against 5 000 devices × 5 fences did 5 000 000 synchronous iterations on the consumer's
    // critical path between writePositions and the XACK — long enough to starve the ShardLeaser's
    // renew timer, expire leases, and make shards flap.
    const e = new GeofenceEngine()
    // seed state for many OTHER devices (the global map the old prune walked per record)
    for (let d = 1000; d < 1300; d++) {
      const r = { ...rec(0, 5, 5), deviceId: BigInt(d) }
      e.feed([r], () => [GF])
    }
    let scanned = 0
    const counting: GeofenceDef[] = [{ ...GF, get geometry() { scanned++; return square } }]
    // one device, many records: the per-device index means cost is O(records × THIS device's fences)
    const many = Array.from({ length: 50 }, (_, i) => ({ ...rec(i * 10, 5, 5), deviceId: 42n }))
    e.feed(many, () => counting)
    expect(scanned).toBeLessThanOrEqual(50) // one geometry read per record, not per global pair
  })

  it('a fence dropped from a device STILL has its state pruned (behaviour preserved)', () => {
    const e = new GeofenceEngine()
    const two: GeofenceDef[] = [GF, { id: 'gf2', name: 'Yard', geometry: square }]
    e.feed([rec(0, 5, 5), rec(10, 5, 5)], () => two) // both confirmed inside
    // gf2 is removed from the device's set; its pair state must go, so a later re-add re-enters
    e.feed([rec(20, 5, 5)], () => [GF])
    const back = e.feed([rec(30, 5, 5), rec(40, 5, 5)], () => two)
    expect(back.map((t) => t.geofenceId)).toContain('gf2') // fresh state ⇒ enter fires again
  })

  it('the bbox prefilter never changes the answer, only the cost', () => {
    // exact rejection: outside the envelope is outside the polygon, always
    const withBox: GeofenceDef = { ...GF, bbox: bboxOf(square) }
    const e1 = new GeofenceEngine()
    const e2 = new GeofenceEngine()
    const path = [rec(0, 5, 5), rec(10, 5, 5), rec(20, 50, 50), rec(30, 50, 50), rec(40, 5, 5), rec(50, 5, 5)]
    expect(e1.feed(path, () => [withBox])).toEqual(e2.feed(path, () => [GF]))
  })
})
