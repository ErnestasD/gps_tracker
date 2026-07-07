import type { NormalizedRecord } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { GeofenceQueueStub, MotionFeed, TripDistanceStub, haversineM, motionRecords } from '../src/motion.js'

const T0 = 1_751_600_000_000

const rec = (
  deviceId: bigint,
  fixTimeMs: number,
  lat: number,
  lon: number,
  fixValid: boolean,
): NormalizedRecord => ({
  deviceId,
  fixTime: new Date(fixTimeMs),
  serverTime: new Date(fixTimeMs + 100),
  lat,
  lon,
  altitude: 120,
  speed: fixValid ? 50 : 0,
  course: fixValid ? 90 : 0,
  satellites: fixValid ? 9 : 0,
  fixValid,
  ignition: true,
  movement: true,
  odometerM: null,
  priority: 0,
  recHash: BigInt(fixTimeMs),
  attrs: {},
})

describe('E02-7 I5 seam (invalid fixes never reach motion consumers)', () => {
  it('motionRecords drops exactly the fixValid=false records, mutating nothing', () => {
    const batch = [
      rec(42n, T0, 54.68, 25.27, true),
      rec(42n, T0 + 1_000, 54.681, 25.272, true),
      rec(42n, T0 + 2_000, 54.681, 25.272, false), // §3.4: repeats last valid coords
      rec(42n, T0 + 3_000, 54.682, 25.274, true),
    ]
    const valid = motionRecords(batch)
    expect(valid.map((r) => r.fixValid)).toEqual([true, true, true])
    expect(batch).toHaveLength(4) // original batch untouched — presence path still sees all
  })

  it('AC[1]a: trip-distance accumulator is identical with and without invalid fixes — even teleporting ones', () => {
    const validOnly = [
      rec(42n, T0, 54.68, 25.27, true),
      rec(42n, T0 + 1_000, 54.681, 25.272, true),
      rec(42n, T0 + 3_000, 54.682, 25.274, true),
    ]
    // same drive, but with invalid fixes interleaved: one §3.4-style (repeats last
    // valid coords) and one adversarial teleport (garbage coords while no fix)
    const withInvalid = [
      validOnly[0]!,
      validOnly[1]!,
      rec(42n, T0 + 1_500, 54.681, 25.272, false),
      rec(42n, T0 + 2_000, 0, 0, false), // teleport to null island
      validOnly[2]!,
    ]
    const a = new MotionFeed()
    const b = new MotionFeed()
    a.feed(validOnly)
    b.feed(withInvalid)
    expect(b.tripDistance.totalM.get('42')).toBe(a.tripDistance.totalM.get('42'))
    expect(a.tripDistance.totalM.get('42')).toBeGreaterThan(0)
  })

  it('AC[1]b: geofence input queue never contains a fixValid=false record', () => {
    const feed = new MotionFeed()
    feed.feed([
      rec(42n, T0, 54.68, 25.27, true),
      rec(42n, T0 + 1_000, 54.681, 25.272, false),
      rec(7n, T0 + 2_000, 54.7, 25.3, false),
      rec(7n, T0 + 3_000, 54.7, 25.3, true),
    ])
    expect(feed.geofenceQueue.queue).toHaveLength(2)
    expect(feed.geofenceQueue.queue.every((r) => r.fixValid)).toBe(true)
  })

  it('an all-invalid batch mutates neither consumer (buffered no-fix stretch)', () => {
    const feed = new MotionFeed()
    feed.feed([rec(42n, T0, 54.68, 25.27, false), rec(42n, T0 + 1_000, 54.68, 25.27, false)])
    expect(feed.tripDistance.totalM.size).toBe(0)
    expect(feed.geofenceQueue.queue).toHaveLength(0)
  })

  it('distance accumulates per device independently', () => {
    const trips = new TripDistanceStub()
    trips.feed([
      rec(1n, T0, 54.0, 25.0, true),
      rec(2n, T0, 55.0, 26.0, true),
      rec(1n, T0 + 1_000, 54.001, 25.0, true),
      rec(2n, T0 + 1_000, 55.002, 26.0, true),
    ])
    expect(trips.totalM.get('1')).toBeCloseTo(haversineM(54.0, 25.0, 54.001, 25.0), 6)
    expect(trips.totalM.get('2')).toBeCloseTo(haversineM(55.0, 26.0, 55.002, 26.0), 6)
  })

  it('haversine sanity: 0.001° lat ≈ 111 m', () => {
    expect(haversineM(54.0, 25.0, 54.001, 25.0)).toBeGreaterThan(105)
    expect(haversineM(54.0, 25.0, 54.001, 25.0)).toBeLessThan(118)
  })

  it('GeofenceQueueStub preserves arrival order (evaluator consumes FIFO)', () => {
    const q = new GeofenceQueueStub()
    q.feed([rec(42n, T0, 54.68, 25.27, true)])
    q.feed([rec(42n, T0 + 1_000, 54.681, 25.272, true)])
    expect(q.queue.map((r) => r.fixTime.getTime())).toEqual([T0, T0 + 1_000])
  })
})
