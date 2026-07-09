import type { NormalizedRecord } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { MotionFeed, haversineM, motionRecords } from '../src/motion.js'

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

  it('MotionFeed returns both trip events and geofence transitions from the SAME I5-filtered records', () => {
    const feed = new MotionFeed()
    // a geofence covering the point; an invalid fix at the same spot must NOT count
    const gf = [{ id: 'g1', name: 'Z', geometry: { type: 'Polygon' as const, coordinates: [[[25.0, 54.0], [26.0, 54.0], [26.0, 55.0], [25.0, 55.0], [25.0, 54.0]]] } }]
    const res = feed.feed(
      [rec(42n, T0, 54.5, 25.5, true), rec(42n, T0 + 1_000, 54.5, 25.5, false), rec(42n, T0 + 2_000, 54.5, 25.5, true)],
      undefined,
      () => gf,
    )
    // 2 valid records inside → enter (invalid one ignored → I5)
    expect(res.transitions).toHaveLength(1)
    expect(res.transitions[0]).toMatchObject({ geofenceId: 'g1', type: 'enter' })
    expect(Array.isArray(res.tripEvents)).toBe(true)
  })

  it('an all-invalid batch emits nothing (buffered no-fix stretch)', () => {
    const feed = new MotionFeed()
    const res = feed.feed([rec(42n, T0, 54.68, 25.27, false), rec(42n, T0 + 1_000, 54.68, 25.27, false)], undefined, () => [])
    expect(res.tripEvents).toHaveLength(0)
    expect(res.transitions).toHaveLength(0)
  })

  it('haversine sanity: 0.001° lat ≈ 111 m', () => {
    expect(haversineM(54.0, 25.0, 54.001, 25.0)).toBeGreaterThan(105)
    expect(haversineM(54.0, 25.0, 54.001, 25.0)).toBeLessThan(118)
  })
})
