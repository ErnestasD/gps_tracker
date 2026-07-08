import type { PositionView, TripView } from '@orbetra/shared'
import maplibregl, { Map as MlMap, LngLatBounds } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'

import { buildTrailFeatures } from '@/lib/liveStore'

const STYLE_URL: string =
  (import.meta.env.VITE_TILES_STYLE_URL as string | undefined) ?? 'https://tiles.openfreemap.org/styles/liberty'
const VILNIUS: [number, number] = [25.2797, 54.6872]
const COLORS = { trail: '#4DA3FF', gap: '#93A1B7', stop: '#F5A524', cursor: '#7C5CFC' }

const pointFC = (feats: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: feats })
const stopFeatures = (trips: TripView[]): GeoJSON.Feature[] => {
  const out: GeoJSON.Feature[] = []
  for (const t of trips) {
    if (t.startLat !== null && t.startLon !== null) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [t.startLon, t.startLat] }, properties: { kind: 'start' } })
    if (t.endLat !== null && t.endLon !== null) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [t.endLon, t.endLat] }, properties: { kind: 'end' } })
  }
  return out
}

/** Static playback map: the whole trail (dashed over invalid-fix gaps, I5), trip
 * start/end markers, and a cursor dot that follows the scrub index. */
export function PlaybackMap({ positions, trips, index }: { positions: PositionView[]; trips: TripView[]; index: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = new MlMap({
      container,
      style: STYLE_URL,
      center: VILNIUS,
      zoom: 10,
      attributionControl: { compact: false, customAttribution: '© OpenStreetMap contributors' },
    })
    mapRef.current = map
    ;(container as HTMLDivElement & { __map?: MlMap }).__map = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('error', (e) => console.error('maplibre', e.error))
    map.on('load', () => {
      map.addSource('trail', { type: 'geojson', data: pointFC([]) })
      map.addSource('stops', { type: 'geojson', data: pointFC([]) })
      map.addSource('cursor', { type: 'geojson', data: pointFC([]) })
      map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', filter: ['!=', ['get', 'gap'], true], paint: { 'line-color': COLORS.trail, 'line-width': 2, 'line-opacity': 0.9 } })
      map.addLayer({ id: 'trail-gap', type: 'line', source: 'trail', filter: ['==', ['get', 'gap'], true], paint: { 'line-color': COLORS.gap, 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] } })
      map.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': 5, 'circle-color': COLORS.stop, 'circle-stroke-width': 2, 'circle-stroke-color': '#0B1020' } })
      map.addLayer({ id: 'cursor', type: 'circle', source: 'cursor', paint: { 'circle-radius': 7, 'circle-color': COLORS.cursor, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })
      setReady(true)
    })
    return () => {
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // trail + stops + fit bounds when the data changes (re-runs once the map is ready)
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !ready) return
    map.getSource<maplibregl.GeoJSONSource>('trail')?.setData(
      pointFC(buildTrailFeatures(positions.map((p) => ({ lon: p.lon, lat: p.lat, fixValid: p.fixValid, fixTimeMs: Date.parse(p.fixTime) })))),
    )
    map.getSource<maplibregl.GeoJSONSource>('stops')?.setData(pointFC(stopFeatures(trips)))
    const valid = positions.filter((p) => p.fixValid)
    if (valid.length > 0) {
      const b = new LngLatBounds([valid[0]!.lon, valid[0]!.lat], [valid[0]!.lon, valid[0]!.lat])
      for (const p of valid) b.extend([p.lon, p.lat])
      map.fitBounds(b, { padding: 48, maxZoom: 15, duration: 400 })
    }
  }, [positions, trips, ready])

  // cursor follows the scrub index
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !ready) return
    const p = positions[index]
    const src = map.getSource<maplibregl.GeoJSONSource>('cursor')
    if (p === undefined || !p.fixValid) src?.setData(pointFC([]))
    else src?.setData(pointFC([{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} }]))
  }, [index, positions, ready])

  return <div ref={containerRef} className="h-full w-full" data-testid="playback-map" />
}
