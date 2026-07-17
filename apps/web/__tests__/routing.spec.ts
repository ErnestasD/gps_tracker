import { describe, expect, it } from 'vitest'

import { parseStopsText } from '../src/lib/routing.js'

describe('ADR-029 parseStopsText', () => {
  it('parses lat,lon lines and skips blank lines', () => {
    const r = parseStopsText('54.6872,25.2797\n\n  \n54.8985,23.9036\n')
    expect(r.errors).toEqual([])
    expect(r.stops).toEqual([
      { lat: 54.6872, lon: 25.2797 },
      { lat: 54.8985, lon: 23.9036 },
    ])
  })

  it('keeps a label — including labels that contain commas', () => {
    const r = parseStopsText('54.7,25.3,Vilnius HQ\n54.9,23.9, Kaunas, Depot 2 ')
    expect(r.stops[0]!.label).toBe('Vilnius HQ')
    expect(r.stops[1]!.label).toBe('Kaunas, Depot 2')
  })

  it('reports bad floats and missing parts as per-line (1-based) errors, keeps good lines', () => {
    const r = parseStopsText('54.7,25.3\nabc,25.3\n54.9\n54.95,def\n55.0,24.0')
    expect(r.stops.map((s) => s.lat)).toEqual([54.7, 55])
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4])
  })

  it('rejects out-of-range coordinates', () => {
    const r = parseStopsText('91,25\n54.7,181\n-90,-180')
    expect(r.errors.map((e) => e.line)).toEqual([1, 2])
    expect(r.stops).toEqual([{ lat: -90, lon: -180 }])
  })

  it('empty commas are errors, not (0,0) stops', () => {
    const r = parseStopsText(',\n,,label')
    expect(r.stops).toEqual([])
    expect(r.errors.map((e) => e.line)).toEqual([1, 2])
  })

  it('caps the label at 120 chars', () => {
    const r = parseStopsText(`54.7,25.3,${'x'.repeat(200)}`)
    expect(r.stops[0]!.label).toHaveLength(120)
  })
})
