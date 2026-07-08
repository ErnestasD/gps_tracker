import type { NormalizedRecord } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { GeofenceQueueStub, MotionFeed, haversineM, motionRecords } from '../src/motion.js'

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

  // (trip-distance I5 invariance now lives in trip-engine.spec against the real engine)

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

  it('an all-invalid batch feeds no motion consumer (buffered no-fix stretch)', () => {
    const feed = new MotionFeed()
    const events = feed.feed([rec(42n, T0, 54.68, 25.27, false), rec(42n, T0 + 1_000, 54.68, 25.27, false)])
    expect(events).toHaveLength(0) // no trip events emitted
    expect(feed.geofenceQueue.queue).toHaveLength(0)
  })

  it('haversine sanity: 0.001° lat ≈ 111 m', () => {
    expect(haversineM(54.0, 25.0, 54.001, 25.0)).toBeGreaterThan(105)
    expect(haversineM(54.0, 25.0, 54.001, 25.0)).toBeLessThan(118)
  })

  it('GeofenceQueueStub is CAPPED — a long-lived worker cannot grow it unboundedly (§10)', () => {
    const q = new GeofenceQueueStub()
    const batch = Array.from({ length: 3_000 }, (_, i) => rec(42n, T0 + i * 1_000, 54.68, 25.27, true))
    for (let i = 0; i < 4; i++) q.feed(batch) // 12k records into a 10k cap
    expect(q.queue.length).toBe(GeofenceQueueStub.CAP)
    expect(q.dropped).toBe(2_000)
    // newest are kept, oldest dropped
    expect(q.queue[q.queue.length - 1]!.fixTime.getTime()).toBe(T0 + 2_999_000)
  })

  it('GeofenceQueueStub preserves arrival order (evaluator consumes FIFO)', () => {
    const q = new GeofenceQueueStub()
    q.feed([rec(42n, T0, 54.68, 25.27, true)])
    q.feed([rec(42n, T0 + 1_000, 54.681, 25.272, true)])
    expect(q.queue.map((r) => r.fixTime.getTime())).toEqual([T0, T0 + 1_000])
  })
})
