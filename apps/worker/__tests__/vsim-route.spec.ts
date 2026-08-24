import { describe, expect, it } from 'vitest'

import { bearingDeg, haversineM, pointAt, prepRoute } from '../src/vsim/route.js'

// Vilnius → Kaunas straight-ish line, three vertices
const COORDS: [number, number][] = [
  [25.2797, 54.6872],
  [24.5, 54.8],
  [23.9036, 54.8985],
]

describe('vsim route math', () => {
  it('prepares cumulative distances that sum segment haversines', () => {
    const r = prepRoute(COORDS)!
    expect(r.totalM).toBeCloseTo(
      haversineM(...COORDS[0]!, ...COORDS[1]!) + haversineM(...COORDS[1]!, ...COORDS[2]!),
      6,
    )
    expect(r.cum[0]).toBe(0)
    expect(r.cum[2]).toBe(r.totalM)
  })

  it('rejects degenerate routes', () => {
    expect(prepRoute([])).toBeNull()
    expect(prepRoute([[25, 54]])).toBeNull()
    expect(prepRoute([[25, 54], [25, 54]])).toBeNull() // zero length
  })

  it('interpolates the endpoints exactly and clamps beyond them', () => {
    const r = prepRoute(COORDS)!
    expect(pointAt(r, 0).lon).toBeCloseTo(COORDS[0]![0], 9)
    expect(pointAt(r, r.totalM).lon).toBeCloseTo(COORDS[2]![0], 9)
    expect(pointAt(r, -50).lat).toBeCloseTo(COORDS[0]![1], 9)
    expect(pointAt(r, r.totalM + 1e6).lat).toBeCloseTo(COORDS[2]![1], 9)
  })

  it('midpoint of the first segment lies between its vertices with a westward course', () => {
    const r = prepRoute(COORDS)!
    const segM = haversineM(...COORDS[0]!, ...COORDS[1]!)
    const p = pointAt(r, segM / 2)
    expect(p.lon).toBeGreaterThan(COORDS[1]![0])
    expect(p.lon).toBeLessThan(COORDS[0]![0])
    // heading toward Kaunas ⇒ westward-ish (between 270±60)
    expect(p.course).toBeGreaterThan(270 - 60)
    expect(p.course).toBeLessThan(270 + 60)
  })

  it('bearing is the AVL clockwise-from-north convention', () => {
    expect(bearingDeg(25, 54, 25, 55)).toBe(0) // due north
    expect(bearingDeg(25, 54, 26, 54)).toBeGreaterThan(80) // eastward
    expect(bearingDeg(25, 54, 26, 54)).toBeLessThan(100)
  })
})
