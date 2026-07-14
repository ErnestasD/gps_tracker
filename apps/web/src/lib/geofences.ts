import type { GeofenceView } from '@orbetra/shared'

import { getJson, mutate } from './client'

/** Geofence API client (E05-1). A corridor (V2) sends a route line + buffer half-width; the
 *  server buffers it to a polygon, so the response's `geometry` is a Polygon like any other. */
export type GeofenceInput =
  | { name: string; kind: 'polygon' | 'circle'; color?: string; accountId?: string | null; geometry: unknown }
  | { name: string; kind: 'corridor'; color?: string; accountId?: string | null; line: unknown; bufferM: number }

export interface GeofenceUpdateInput {
  name?: string
  color?: string
  geometry?: unknown // GeoJSON Polygon
}

export const listGeofences = () => getJson<GeofenceView[]>('/v1/geofences')
export const createGeofence = (data: GeofenceInput) => mutate<GeofenceView>('POST', '/v1/geofences', data)
export const updateGeofence = (id: string, data: GeofenceUpdateInput) => mutate<GeofenceView>('PATCH', `/v1/geofences/${encodeURIComponent(id)}`, data)
export const deleteGeofence = (id: string) => mutate<{ ok: boolean }>('DELETE', `/v1/geofences/${encodeURIComponent(id)}`)

/** GeoJSON FeatureCollection of geofence polygons for a MapLibre fill/line source. */
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
