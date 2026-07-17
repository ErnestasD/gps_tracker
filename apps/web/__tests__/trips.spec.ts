import { describe, expect, it } from 'vitest'

import { fmtDuration, fmtKm, tripAvgSpeedKmh, tripDurationMs, tripsQuery } from '../src/lib/trips.js'

describe('E04-4 trips helpers', () => {
  it('tripsQuery adds deviceId alongside from/to', () => {
    expect(tripsQuery({})).toBe('')
    expect(tripsQuery({ deviceId: '123' })).toBe('?deviceId=123')
    expect(tripsQuery({ from: '2026-07-01T00:00', deviceId: '123' })).toContain('deviceId=123')
    expect(tripsQuery({ from: '2026-07-01T00:00', deviceId: '123' })).toContain('from=')
  })

  it('tripDurationMs: closed trip = end−start; open trip runs to now', () => {
    const now = Date.parse('2026-07-01T12:00:00Z')
    expect(tripDurationMs({ startTime: '2026-07-01T10:00:00Z', endTime: '2026-07-01T10:30:00Z' }, now)).toBe(30 * 60_000)
    expect(tripDurationMs({ startTime: '2026-07-01T11:00:00Z', endTime: null }, now)).toBe(60 * 60_000)
    // never negative if clocks disagree
    expect(tripDurationMs({ startTime: '2026-07-01T13:00:00Z', endTime: null }, now)).toBe(0)
  })

  it('fmtDuration is compact across scales', () => {
    expect(fmtDuration(0)).toBe('0s')
    expect(fmtDuration(45_000)).toBe('45s')
    expect(fmtDuration(90_000)).toBe('1m 30s')
    expect(fmtDuration(3_661_000)).toBe('1h 1m')
  })

  it('fmtKm rounds to one decimal', () => {
    expect(fmtKm(0)).toBe('0.0 km')
    expect(fmtKm(1234)).toBe('1.2 km')
  })

  it('tripAvgSpeedKmh = distance/duration; open trips run to now; zero-duration → 0, never NaN', () => {
    const now = Date.parse('2026-07-01T12:00:00Z')
    // 30 km in 30 min → 60 km/h
    expect(tripAvgSpeedKmh({ startTime: '2026-07-01T10:00:00Z', endTime: '2026-07-01T10:30:00Z', distanceM: 30_000 }, now)).toBe(60)
    // open trip: 45 km over the 1 h to `now` → 45 km/h
    expect(tripAvgSpeedKmh({ startTime: '2026-07-01T11:00:00Z', endTime: null, distanceM: 45_000 }, now)).toBe(45)
    // degenerate window (start in the future clamps to 0 duration) → 0, not Infinity
    expect(tripAvgSpeedKmh({ startTime: '2026-07-01T13:00:00Z', endTime: null, distanceM: 5_000 }, now)).toBe(0)
  })
})
