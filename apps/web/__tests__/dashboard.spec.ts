import type { LiveEvent } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { dailyKmSeries, eventSeverity, fleetCounts } from '../src/lib/dashboard.js'

const NOW = Date.UTC(2026, 6, 16, 12, 0, 0)
const pos = (ageMs: number): LiveEvent => ({ deviceId: '1', accountId: 'a', fixTimeMs: NOW - ageMs, lat: 54, lon: 25, speed: 10, course: 0, satellites: 8, fixValid: true, ignition: true, priority: 0 })

describe('ADR-028 dashboard helpers', () => {
  it('fleetCounts buckets by the live-map freshness thresholds', () => {
    const c = fleetCounts([pos(10_000), pos(59_999), pos(60_001), pos(599_999), pos(600_001)], NOW)
    expect(c).toEqual({ online: 2, stale: 2, offline: 1 })
  })

  it('eventSeverity maps kinds to the shared severity buckets', () => {
    expect(eventSeverity('panic')).toBe('critical')
    expect(eventSeverity('power_cut')).toBe('critical')
    expect(eventSeverity('overspeed')).toBe('warning')
    expect(eventSeverity('device_offline')).toBe('warning')
    expect(eventSeverity('geofence')).toBe('info')
    expect(eventSeverity('ignition')).toBe('info')
  })

  it('dailyKmSeries aggregates per-device rows into fleet km per day, sorted, garbage-safe', () => {
    const rows = [
      { day: '2026-07-15', deviceId: '1', distanceM: 12_000 },
      { day: '2026-07-15', deviceId: '2', distanceM: 8_000 },
      { day: '2026-07-14', deviceId: '1', distanceM: 5_500 },
      { day: '2026-07-15', deviceId: '3', distanceM: 'garbage' }, // jsonb junk → 0
      { deviceId: '4', distanceM: 1000 }, // no day → dropped
    ]
    expect(dailyKmSeries(rows)).toEqual([
      { day: '2026-07-14', km: 5.5 },
      { day: '2026-07-15', km: 20 },
    ])
  })

  it('dailyKmSeries of nothing is empty (dashboard shows the empty state)', () => {
    expect(dailyKmSeries([])).toEqual([])
  })
})
