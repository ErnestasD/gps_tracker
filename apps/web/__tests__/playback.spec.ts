import { describe, expect, it } from 'vitest'

import { chartPoints } from '../src/components/SpeedChart.js'
import { defaultRange, historyQuery } from '../src/lib/playback.js'

describe('E04-3 playback helpers', () => {
  it('defaultRange round-trips through local Date parsing and always covers `now` (any timezone)', () => {
    // regression ×2: (a) the old UTC-formatted datetime-local string re-parsed as LOCAL
    // time — east of UTC the range ended hours in the past and fresh positions vanished;
    // (b) minute-floored `to` excluded the current partial minute. `to` must be ≥ now.
    const now = Date.now()
    const r = defaultRange(now)
    const to = new Date(r.to).getTime()
    const from = new Date(r.from).getTime()
    expect(to).toBeGreaterThanOrEqual(now)
    expect(to - now).toBeLessThanOrEqual(120_000) // ceiled ≤ 2 min ahead
    expect(Math.floor(from / 60_000)).toBe(Math.floor((now - 24 * 3_600_000) / 60_000))
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
