import type { PositionView, TripView } from '@orbetra/shared'
import type { GeoJSONSource, Map as MbMap } from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'

import { MapErrorOverlay } from '@/components/MapErrorOverlay'
import { buildTrailFeatures } from '@/lib/liveStore'
import { createThemedMap, mapboxgl, watchMapLoad } from '@/lib/map'

const VILNIUS: [number, number] = [25.2797, 54.6872]
// ADR-028 palette: trail = --accent (dark), gap = --muted
const COLORS = { trail: '#7C7DF5', gap: '#8B93A7', stop: '#F5A524', cursor: '#7C5CFC' }

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
  const mapRef = useRef<MbMap | null>(null)
  // bumps on EVERY style.load (initial + theme swaps, ADR-030) so the data effects
  // below re-apply setData/filters to the freshly rebuilt (empty) sources
  const [styleEpoch, setStyleEpoch] = useState(0)
  const [mapError, setMapError] = useState(false) // constructor threw / style never loaded
  // the positions array the camera was last fitted to — a theme swap re-runs the data
  // effect (styleEpoch bump) but must NOT yank the camera back to the full bounds
  const lastFitRef = useRef<PositionView[] | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { map, unsubscribe } = createThemedMap(container, { center: VILNIUS, zoom: 10 })
    const stopWatch = watchMapLoad(map, setMapError)
    if (map === null) {
      // missing token / WebGL failure — the overlay is up, nothing to wire
      return () => {
        stopWatch()
        unsubscribe()
      }
    }
    mapRef.current = map
    ;(container as HTMLDivElement & { __map?: MbMap }).__map = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('error', (e) => console.error('mapbox', e.error))
    let disposed = false
    // idempotent: style.load re-fires after every theme setStyle (layers were dropped)
    map.on('style.load', () => {
      if (disposed) return
      if (!map.getSource('trail')) {
        map.addSource('trail', { type: 'geojson', data: pointFC([]) })
        map.addSource('stops', { type: 'geojson', data: pointFC([]) })
        map.addSource('cursor', { type: 'geojson', data: pointFC([]) })
        map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', filter: ['!=', ['get', 'gap'], true], paint: { 'line-color': COLORS.trail, 'line-width': 2, 'line-opacity': 0.9 } })
        map.addLayer({ id: 'trail-gap', type: 'line', source: 'trail', filter: ['==', ['get', 'gap'], true], paint: { 'line-color': COLORS.gap, 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] } })
        map.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': 5, 'circle-color': COLORS.stop, 'circle-stroke-width': 2, 'circle-stroke-color': '#0A0E1A' } })
        map.addLayer({ id: 'cursor', type: 'circle', source: 'cursor', paint: { 'circle-radius': 7, 'circle-color': COLORS.cursor, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })
      }
      setStyleEpoch((e) => e + 1)
    })
    return () => {
      disposed = true
      stopWatch()
      unsubscribe()
      map.remove()
      mapRef.current = null
      lastFitRef.current = null
      setStyleEpoch(0)
    }
  }, [])

  // trail + stops re-applied when the data (or the style, on theme swap) changes;
  // fitBounds ONLY when the positions themselves changed — not on styleEpoch bumps
  useEffect(() => {
    const map = mapRef.current
    if (map === null || styleEpoch === 0) return
    map.getSource<GeoJSONSource>('trail')?.setData(
      pointFC(buildTrailFeatures(positions.map((p) => ({ lon: p.lon, lat: p.lat, fixValid: p.fixValid, fixTimeMs: Date.parse(p.fixTime) })))),
    )
    map.getSource<GeoJSONSource>('stops')?.setData(pointFC(stopFeatures(trips)))
    if (positions === lastFitRef.current) return // theme swap: keep the user's camera
    lastFitRef.current = positions
    const valid = positions.filter((p) => p.fixValid)
    if (valid.length > 0) {
      const b = new mapboxgl.LngLatBounds([valid[0]!.lon, valid[0]!.lat], [valid[0]!.lon, valid[0]!.lat])
      for (const p of valid) b.extend([p.lon, p.lat])
      map.fitBounds(b, { padding: 48, maxZoom: 15, duration: 400 })
    }
  }, [positions, trips, styleEpoch])

  // cursor follows the scrub index
  useEffect(() => {
    const map = mapRef.current
    if (map === null || styleEpoch === 0) return
    const p = positions[index]
    const src = map.getSource<GeoJSONSource>('cursor')
    if (p === undefined || !p.fixValid) src?.setData(pointFC([]))
    else src?.setData(pointFC([{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} }]))
  }, [index, positions, styleEpoch])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" data-testid="playback-map" />
      <MapErrorOverlay show={mapError} testId="playback-map-error" />
    </div>
  )
}
