import { describe, expect, it } from 'vitest'

import { fuelAtTime, fuelChartPoints, fuelCursorX, fuelSeries } from '../src/lib/fuel.js'

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0)
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString()
const s = (min: number, pct: number | null, liters: number | null) => ({ fixTime: iso(min), pct, liters })

describe('E08-3 fuelSeries (pure)', () => {
  it('prefers the percent series when any sample has one, keeping timestamps', () => {
    const r = fuelSeries([s(0, 80, null), s(1, 79, 41.2), s(2, null, 40.5)])
    expect(r.unit).toBe('pct')
    expect(r.points).toEqual([
      { tMs: T0, v: 80 },
      { tMs: T0 + 60_000, v: 79 },
    ]) // liters-only sample dropped, NOT zeroed
  })

  it('falls back to liters when no sample has a percent', () => {
    const r = fuelSeries([s(0, null, 41.2), s(1, null, 40.5)])
    expect(r.unit).toBe('l')
    expect(r.points.map((p) => p.v)).toEqual([41.2, 40.5])
  })

  it('empty in → empty out (chart hidden, AVL-gated)', () => {
    expect(fuelSeries([]).points).toEqual([])
  })
})

describe('playback overlay fuelAtTime (pure)', () => {
  const pts = [
    { tMs: T0, v: 80 },
    { tMs: T0 + 60_000, v: 79 },
    { tMs: T0 + 10 * 60_000, v: 70 },
  ]

  it('returns the latest sample at-or-before t (sparse reporting holds the last value)', () => {
    expect(fuelAtTime(pts, T0)).toBe(80) // exactly on a sample
    expect(fuelAtTime(pts, T0 + 90_000)).toBe(79) // between samples → previous holds
    expect(fuelAtTime(pts, T0 + 60 * 60_000)).toBe(70) // past the end → last
  })

  it('returns null before the first sample and for an empty series', () => {
    expect(fuelAtTime(pts, T0 - 1)).toBeNull()
    expect(fuelAtTime([], T0)).toBeNull()
  })
})

describe('E08-3 fuelChartPoints (time-scaled x)', () => {
  it('places points by TIME, not index — sparse reporting cannot shift a dip', () => {
    // three points: 0 min, 1 min, 11 min. Index spacing would put the middle point at
    // x=center; time spacing puts it at 1/11 of the span.
    const pts = fuelChartPoints(
      [
        { tMs: T0, v: 100 },
        { tMs: T0 + 60_000, v: 50 },
        { tMs: T0 + 11 * 60_000, v: 100 },
      ],
      116, 100, 8, // innerW = 100
    )
    expect(pts.map(([x]) => x)).toEqual([8, 8 + 100 / 11, 108])
  })

  it('y is inverted and scaled to the series max; empty → []', () => {
    const pts = fuelChartPoints([{ tMs: T0, v: 100 }, { tMs: T0 + 1000, v: 0 }], 112, 106, 6)
    expect(pts[0]![1]).toBe(6) // max value → top
    expect(pts[1]![1]).toBe(100) // zero → bottom
    expect(fuelChartPoints([], 100, 100, 6)).toEqual([])
  })
})

describe('playback fuel scrub cursor fuelCursorX (pure)', () => {
  const pts = [
    { tMs: T0, v: 80 },
    { tMs: T0 + 10 * 60_000, v: 70 },
  ]

  it('places the cursor by TIME within the padded box', () => {
    // span = 10 min, w=116 pad=8 → innerW=100
    expect(fuelCursorX(pts, T0, 116, 8)).toBe(8) // at series start → left edge
    expect(fuelCursorX(pts, T0 + 5 * 60_000, 116, 8)).toBe(58) // halfway
    expect(fuelCursorX(pts, T0 + 10 * 60_000, 116, 8)).toBe(108) // at series end → right edge
  })

  it('clamps outside the series span (scrub before first / after last sample)', () => {
    expect(fuelCursorX(pts, T0 - 60_000, 116, 8)).toBe(8)
    expect(fuelCursorX(pts, T0 + 60 * 60_000, 116, 8)).toBe(108)
  })

  it('empty series → null (no cursor drawn)', () => {
    expect(fuelCursorX([], T0, 116, 8)).toBeNull()
  })
})
