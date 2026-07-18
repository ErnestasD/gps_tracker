import type { LiveEvent } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { areaPath, countDelta, dailyActiveDevices, dailyCounts, dailyKmSeries, dayStrInTz, donutSegments, eventSeverity, fleetCounts, hourInTz, hourlyBuckets, kindBreakdown, localDayStr, pctDelta } from '../src/lib/dashboard.js'

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

  it('dailyActiveDevices counts DISTINCT devices per day, sorted, garbage-safe', () => {
    const rows = [
      { day: '2026-07-15', deviceId: '1', distanceM: 100 },
      { day: '2026-07-15', deviceId: '2', distanceM: 100 },
      { day: '2026-07-15', deviceId: '1', distanceM: 100 }, // duplicate device
      { day: '2026-07-14', deviceId: '1', distanceM: 100 },
      { day: '2026-07-14', deviceId: 3, distanceM: 100 }, // numeric id coerces
      { day: '', deviceId: '9' }, // no day → dropped
      { day: '2026-07-13' }, // no device → dropped
    ]
    expect(dailyActiveDevices(rows)).toEqual([
      { day: '2026-07-14', count: 2 },
      { day: '2026-07-15', count: 2 },
    ])
  })
})

describe('stat-card deltas', () => {
  it('pctDelta: signed percent with up/down/flat tone', () => {
    expect(pctDelta(118, 100)).toEqual({ value: '+18%', tone: 'up' })
    expect(pctDelta(75, 100)).toEqual({ value: '−25%', tone: 'down' })
    expect(pctDelta(100, 100)).toEqual({ value: '0%', tone: 'flat' })
  })

  it('pctDelta: sub-half-percent change rounds to flat 0%', () => {
    expect(pctDelta(100.4, 100)).toEqual({ value: '0%', tone: 'flat' })
  })

  it('pctDelta: zero baseline → null (no made-up percentage), unless both are zero', () => {
    expect(pctDelta(5, 0)).toBeNull()
    expect(pctDelta(0, 0)).toEqual({ value: '0%', tone: 'flat' })
  })

  it('countDelta: signed absolute difference', () => {
    expect(countDelta(5, 2)).toEqual({ value: '+3', tone: 'up' })
    expect(countDelta(1, 3)).toEqual({ value: '−2', tone: 'down' })
    expect(countDelta(4, 4)).toEqual({ value: '±0', tone: 'flat' })
  })
})

describe('event bucketing (donut / hourly / sparks)', () => {
  it('localDayStr renders the local calendar day of a timestamp', () => {
    // constructed with the LOCAL Date ctor, so the expectation holds in any zone
    expect(localDayStr(new Date(2026, 6, 16, 12, 0).getTime())).toBe('2026-07-16')
    expect(localDayStr(new Date(2026, 0, 5, 0, 30).getTime())).toBe('2026-01-05')
  })

  it('dayStrInTz buckets by a specific IANA zone (matching the account-tz report), falls back to browser-local', () => {
    // 2026-07-14T23:30:00Z is still July 14 in UTC but already July 15 in Vilnius (UTC+3 summer)
    const ms = Date.parse('2026-07-14T23:30:00.000Z')
    expect(dayStrInTz(ms, 'UTC')).toBe('2026-07-14')
    expect(dayStrInTz(ms, 'Europe/Vilnius')).toBe('2026-07-15')
    expect(dayStrInTz(ms, 'Not/AZone')).toBe(localDayStr(ms)) // bad zone → browser-local, no throw
    expect(dayStrInTz(ms)).toBe(localDayStr(ms)) // omitted → browser-local
  })

  it('hourInTz resolves the hour-of-day in a given zone', () => {
    const iso = '2026-07-14T23:30:00.000Z'
    expect(hourInTz(iso, 'UTC')).toBe(23)
    expect(hourInTz(iso, 'Europe/Vilnius')).toBe(2) // 02:30 next day, UTC+3
    expect(Number.isNaN(hourInTz('garbage', 'UTC'))).toBe(true)
  })

  it('hourlyBuckets counts per hour of day (24 buckets), dropping unparseable timestamps', () => {
    const at = (h: number) => ({ at: new Date(2026, 6, 10, h, 30).toISOString() })
    const buckets = hourlyBuckets([at(13), at(13), at(0), at(23), { at: 'garbage' }])
    expect(buckets).toHaveLength(24)
    expect(buckets[13]).toBe(2)
    expect(buckets[0]).toBe(1)
    expect(buckets[23]).toBe(1)
    expect(buckets.reduce((s, n) => s + n, 0)).toBe(4)
  })

  it('hourlyBuckets accepts an injected hour resolver and ignores out-of-range hours', () => {
    const hours = [5, 5, 7, 24, -1, Number.NaN]
    const buckets = hourlyBuckets(hours.map((h) => ({ at: String(h) })), (iso) => Number(iso))
    expect(buckets[5]).toBe(2)
    expect(buckets[7]).toBe(1)
    expect(buckets.reduce((s, n) => s + n, 0)).toBe(3)
  })

  it('dailyCounts fills the trailing N local days (oldest first), dropping out-of-window rows', () => {
    const nowMs = new Date(2026, 6, 16, 12, 0).getTime()
    const at = (y: number, m: number, d: number, h: number) => ({ at: new Date(y, m, d, h).toISOString() })
    const counts = dailyCounts([at(2026, 6, 16, 8), at(2026, 6, 16, 1), at(2026, 6, 15, 23), at(2026, 6, 10, 12), at(2026, 6, 8, 12), { at: 'garbage' }], 7, nowMs)
    expect(counts).toEqual([1, 0, 0, 0, 0, 1, 2])
  })

  it('kindBreakdown sorts by count desc, ties alphabetically', () => {
    const ev = (kind: string) => ({ kind })
    expect(kindBreakdown([ev('panic'), ev('overspeed'), ev('geofence'), ev('overspeed'), ev('geofence')])).toEqual([
      { kind: 'geofence', count: 2 },
      { kind: 'overspeed', count: 2 },
      { kind: 'panic', count: 1 },
    ])
    expect(kindBreakdown([])).toEqual([])
  })
})

describe('SVG chart math', () => {
  it('donutSegments splits the circumference proportionally with 2px gaps and cumulative offsets', () => {
    // r=50 → C = 2π·50 ≈ 314.16; shares 3:1 → 235.62/78.54 minus the 2px gap
    expect(donutSegments([{ kind: 'a', count: 3 }, { kind: 'b', count: 1 }], 50)).toEqual([
      { kind: 'a', count: 3, dash: '233.62 80.54', offset: 0 },
      { kind: 'b', count: 1, dash: '76.54 237.62', offset: -235.62 },
    ])
  })

  it('donutSegments: a single segment gets the whole ring (no gap); zero total → []', () => {
    expect(donutSegments([{ kind: 'a', count: 5 }], 50)).toEqual([{ kind: 'a', count: 5, dash: '314.16 0', offset: 0 }])
    expect(donutSegments([], 50)).toEqual([])
    expect(donutSegments([{ kind: 'a', count: 0 }], 50)).toEqual([])
  })

  it('areaPath scales into the box and hits both endpoints (smooth cubic between)', () => {
    const { line, area } = areaPath([0, 10], 100, 40)
    expect(line).toBe('M0,40 C16.67,33.33 83.33,6.67 100,0')
    expect(area).toBe('M0,40 C16.67,33.33 83.33,6.67 100,0 L100,40 L0,40 Z')
  })

  it('areaPath: one point draws a flat line, no points draws nothing', () => {
    expect(areaPath([5], 100, 40)).toEqual({ line: 'M0,0 L100,0', area: 'M0,0 L100,0 L100,40 L0,40 Z' })
    expect(areaPath([], 100, 40)).toEqual({ line: '', area: '' })
  })

  it('areaPath clamps control points inside the box (no dips below the baseline)', () => {
    // a hard 10→0→0 step tempts the curve below y=h; every C y-coordinate must stay ≤ h
    const { line } = areaPath([10, 0, 0], 100, 40)
    const ys = [...line.matchAll(/[C ](-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]))
    expect(ys.length).toBeGreaterThan(0)
    for (const y of ys) expect(y).toBeLessThanOrEqual(40)
  })
})
