import type { GeofenceView } from '@orbetra/shared'

import { getJson, mutate } from './client'

/** Geofence API client (E05-1). A corridor (V2) sends a route line + buffer half-width; the
 *  server buffers it to a polygon, so the response's `geometry` is a Polygon like any other. */
export type GeofenceInput =
  | { name: string; kind: 'polygon' | 'circle'; color?: string; accountId?: string | null; geometry: unknown }
  | { name: string; kind: 'corridor'; color?: string; accountId?: string | null; line: unknown; bufferM: number }

export const listGeofences = () => getJson<GeofenceView[]>('/v1/geofences')
export const createGeofence = (data: GeofenceInput) => mutate<GeofenceView>('POST', '/v1/geofences', data)
export const deleteGeofence = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/geofences/${encodeURIComponent(id)}`)

/** GeoJSON FeatureCollection of geofence polygons for a Mapbox GL fill/line source. */
export function geofenceFeatures(geofences: GeofenceView[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geofences.map((g) => ({
      type: 'Feature',
      id: g.id,
      geometry: g.geometry as GeoJSON.Geometry,
      properties: { id: g.id, name: g.name, color: g.color },
    })),
  }
}

/** [W,S,E,N] bounding box of a geofence's stored polygon — used to fit the map to a selected
 * zone. Walks every ring/segment of a Polygon or MultiPolygon; null for anything else (the
 * server stores every kind — circle/corridor included — as a buffered Polygon). Pure. */
export function geofenceBounds(geometry: unknown): [number, number, number, number] | null {
  const g = geometry as { type?: string; coordinates?: unknown } | null
  if (g === null || typeof g !== 'object') return null
  const rings: unknown =
    g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? (g.coordinates as unknown[])?.flat(1) : null
  if (!Array.isArray(rings)) return null
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue
    for (const pos of ring) {
      if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') continue
      w = Math.min(w, pos[0]); e = Math.max(e, pos[0])
      s = Math.min(s, pos[1]); n = Math.max(n, pos[1])
    }
  }
  return Number.isFinite(w) && Number.isFinite(s) ? [w, s, e, n] : null
}
