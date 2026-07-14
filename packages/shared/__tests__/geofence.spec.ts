import { describe, expect, it } from 'vitest'

import { geofenceCreateSchema } from '../src/entities.js'

/**
 * Geofence create schema — the corridor (V2) discriminated shape. The refine enforces that a
 * corridor carries exactly { line, bufferM } (no polygon), and polygon/circle carry exactly
 * { geometry } (no line). This is the shape gate before the server's ST_Buffer + area cap.
 */
const LINE = { type: 'LineString', coordinates: [[25.27, 54.687], [25.29, 54.688]] }
const POLY = { type: 'Polygon', coordinates: [[[25.26, 54.67], [25.3, 54.67], [25.3, 54.7], [25.26, 54.67]]] }

describe('geofenceCreateSchema — corridor', () => {
  it('accepts a corridor with line + bufferM', () => {
    const r = geofenceCreateSchema.safeParse({ name: 'A1', kind: 'corridor', line: LINE, bufferM: 150 })
    expect(r.success).toBe(true)
  })

  it('rejects a corridor missing bufferM', () => {
    expect(geofenceCreateSchema.safeParse({ name: 'A1', kind: 'corridor', line: LINE }).success).toBe(false)
  })

  it('rejects a corridor that also carries a polygon geometry', () => {
    expect(geofenceCreateSchema.safeParse({ name: 'A1', kind: 'corridor', line: LINE, bufferM: 150, geometry: POLY }).success).toBe(false)
  })

  it('rejects a polygon that carries a line instead of geometry', () => {
    expect(geofenceCreateSchema.safeParse({ name: 'P', kind: 'polygon', line: LINE, bufferM: 150 }).success).toBe(false)
  })

  it('rejects a bufferM outside 10 m … 5 km', () => {
    expect(geofenceCreateSchema.safeParse({ name: 'A1', kind: 'corridor', line: LINE, bufferM: 5 }).success).toBe(false)
    expect(geofenceCreateSchema.safeParse({ name: 'A1', kind: 'corridor', line: LINE, bufferM: 9_000 }).success).toBe(false)
  })

  it('accepts a plain polygon with geometry (regression)', () => {
    expect(geofenceCreateSchema.safeParse({ name: 'P', kind: 'polygon', geometry: POLY }).success).toBe(true)
  })
})
