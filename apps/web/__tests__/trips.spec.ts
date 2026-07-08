import { describe, expect, it } from 'vitest'

import { fmtDuration, fmtKm, tripDurationMs, tripsQuery } from '../src/lib/trips.js'

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
})
