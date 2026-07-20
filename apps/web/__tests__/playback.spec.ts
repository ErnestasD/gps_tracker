import { describe, expect, it } from 'vitest'

import { chartPoints } from '../src/components/SpeedChart.js'
import { dayEndIso, dayStartIso, defaultDayRange, historyQuery } from '../src/lib/playback.js'

describe('E04-3 playback helpers', () => {
  it('defaultDayRange (yesterday→today) + day bounds always cover `now` in any timezone', () => {
    // successor to the defaultRange regressions: date-only pickers (ADR-028 round-2
    // amendment) query FULL local days, so the freshest positions must sit inside
    // [dayStart(from), dayEnd(to)] — the old UTC-vs-local and minute-floor traps stay
    // covered because bounds come from local Date components and `to` ends at 23:59:59.999.
    const now = Date.now()
    const r = defaultDayRange(now)
    const from = new Date(dayStartIso(r.from)).getTime()
    const to = new Date(dayEndIso(r.to)).getTime()
    expect(from).toBeLessThanOrEqual(now - 24 * 3_600_000) // window start covered
    expect(to).toBeGreaterThanOrEqual(now) // today's day-end is always ≥ now
    expect(from).toBeLessThan(to)
  })

  it('dayStartIso/dayEndIso bound the same LOCAL calendar day', () => {
    const d = new Date(2026, 6, 15, 13, 37, 11) // local wall-clock, mid-day
    const start = new Date(dayStartIso(d))
    const end = new Date(dayEndIso(d))
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0])
    expect([end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([23, 59, 59])
    expect(end.getDate()).toBe(start.getDate()) // same local day
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000 - 1)
  })

  it('dayStartIso/dayEndIso anchor the picked calendar day in an explicit time zone', () => {
    // the picked day (local Y/M/D of the Date) is interpreted in the display-prefs zone, so the
    // query window matches the day LABELS the user sees. Tokyo (UTC+9) / Honolulu (UTC-10): both
    // DST-free, so the expected UTC instants are exact and machine-tz-independent.
    const d = new Date(2026, 6, 15) // picked day = 2026-07-15 (local components)
    expect(dayStartIso(d, 'Asia/Tokyo')).toBe('2026-07-14T15:00:00.000Z')
    expect(dayEndIso(d, 'Asia/Tokyo')).toBe('2026-07-15T14:59:59.999Z')
    expect(dayStartIso(d, 'Pacific/Honolulu')).toBe('2026-07-15T10:00:00.000Z')
    expect(dayEndIso(d, 'Pacific/Honolulu')).toBe('2026-07-16T09:59:59.999Z')
  })

  it('day bounds fall back to browser-local for an invalid/omitted zone (no throw)', () => {
    const d = new Date(2026, 6, 15, 9, 0, 0)
    expect(dayStartIso(d, 'Not/AZone')).toBe(dayStartIso(d)) // bad zone → legacy local behavior
    expect(dayEndIso(d, 'Not/AZone')).toBe(dayEndIso(d))
  })

  it('defaultDayRange resolves "today" in the given zone (yesterday→today calendar days)', () => {
    // UTC 2026-07-15T05:00 is already 2026-07-15 14:00 in Tokyo → today=15, yesterday=14
    const r = defaultDayRange(Date.UTC(2026, 6, 15, 5, 0, 0), 'Asia/Tokyo')
    expect([r.to.getFullYear(), r.to.getMonth(), r.to.getDate()]).toEqual([2026, 6, 15])
    expect([r.from.getFullYear(), r.from.getMonth(), r.from.getDate()]).toEqual([2026, 6, 14])
    // the resulting window still brackets that instant when read back in the same zone
    const from = new Date(dayStartIso(r.from, 'Asia/Tokyo')).getTime()
    const to = new Date(dayEndIso(r.to, 'Asia/Tokyo')).getTime()
    expect(from).toBeLessThanOrEqual(Date.UTC(2026, 6, 15, 5, 0, 0))
    expect(to).toBeGreaterThanOrEqual(Date.UTC(2026, 6, 15, 5, 0, 0))
  })

  it('historyQuery omits empty params, encodes present ones', () => {
    expect(historyQuery({})).toBe('')
    expect(historyQuery({ from: '2026-07-01T00:00', limit: 100 })).toContain('from=2026-07-01T00%3A00')
    expect(historyQuery({ limit: 100 })).toBe('?limit=100')
  })

  it('chartPoints maps speeds to inverted SVG coords within the padded box', () => {
    const pts = chartPoints([0, 50, 100], 600, 120, 6)
    expect(pts).toHaveLength(3)
    // first x at pad, last x at width−pad
    expect(pts[0]![0]).toBeCloseTo(6)
    expect(pts[2]![0]).toBeCloseTo(594)
    // y inverted: max speed (100) → top (pad), min (0) → bottom (h−pad)
    expect(pts[2]![1]).toBeCloseTo(6) // fastest → highest
    expect(pts[0]![1]).toBeCloseTo(114) // slowest → lowest
  })

  it('chartPoints handles a single sample and empty input without NaN', () => {
    expect(chartPoints([])).toEqual([])
    const one = chartPoints([42])
    expect(one).toHaveLength(1)
    expect(Number.isNaN(one[0]![0])).toBe(false)
  })
})
