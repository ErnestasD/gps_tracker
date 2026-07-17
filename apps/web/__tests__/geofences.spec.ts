import { geoJsonPolygonSchema } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { geofenceBounds, geofenceFeatures } from '../src/lib/geofences.js'

const poly = { type: 'Polygon' as const, coordinates: [[[25.0, 54.0], [25.1, 54.0], [25.1, 54.1], [25.0, 54.1], [25.0, 54.0]]] }

describe('E05-1 geofence helpers', () => {
  it('geofenceFeatures builds a FeatureCollection with color/name props', () => {
    const fc = geofenceFeatures([
      { id: 'g1', tenantId: 't', accountId: null, name: 'A', color: '#ff0000', kind: 'polygon', geometry: poly, createdAt: '2026-07-01T00:00:00Z' },
    ])
    expect(fc.type).toBe('FeatureCollection')
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0]!.properties).toMatchObject({ color: '#ff0000', name: 'A' })
  })

  it('geofenceBounds returns [W,S,E,N] of a Polygon and null for non-polygons', () => {
    expect(geofenceBounds(poly)).toEqual([25.0, 54.0, 25.1, 54.1])
    // MultiPolygon: bounds span every part
    expect(
      geofenceBounds({ type: 'MultiPolygon', coordinates: [poly.coordinates, [[[26, 55], [26.2, 55], [26.2, 55.2], [26, 55.2], [26, 55]]]] }),
    ).toEqual([25.0, 54.0, 26.2, 55.2])
    // not a polygon / malformed → null (map fit is skipped, never NaN bounds)
    expect(geofenceBounds({ type: 'Point', coordinates: [25, 54] })).toBeNull()
    expect(geofenceBounds(null)).toBeNull()
    expect(geofenceBounds({ type: 'Polygon', coordinates: 'junk' })).toBeNull()
  })

  it('geoJsonPolygonSchema accepts a closed ring, rejects an open/short one', () => {
    expect(geoJsonPolygonSchema.safeParse(poly).success).toBe(true)
    // not closed (first !== last)
    expect(geoJsonPolygonSchema.safeParse({ type: 'Polygon', coordinates: [[[25, 54], [25.1, 54], [25.1, 54.1], [25, 54.1]]] }).success).toBe(false)
    // fewer than 4 positions
    expect(geoJsonPolygonSchema.safeParse({ type: 'Polygon', coordinates: [[[25, 54], [25.1, 54], [25, 54]]] }).success).toBe(false)
    // out-of-range coordinate
    expect(geoJsonPolygonSchema.safeParse({ type: 'Polygon', coordinates: [[[200, 54], [25.1, 54], [25.1, 54.1], [200, 54]]] }).success).toBe(false)
  })
})
