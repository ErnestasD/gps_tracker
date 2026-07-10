import { describe, expect, it } from 'vitest'

import { fuelChartPoints, fuelSeries } from '../src/lib/fuel.js'

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
