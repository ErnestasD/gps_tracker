import maplibregl, { Map as MlMap, type MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import { liveStore, type MapFrame } from '@/lib/liveStore'

/**
 * The ONLY place the tiles style is read (AC[4]: swapping providers = env change,
 * zero code). Default per PROJECT_PLAN §6.7; CLAUDE.md rule 13: free stack only.
 */
const STYLE_URL: string =
  (import.meta.env.VITE_TILES_STYLE_URL as string | undefined) ??
  'https://tiles.openfreemap.org/styles/liberty'

const VILNIUS: [number, number] = [25.2797, 54.6872]

// ADR-028 palette: online = --accent (dark), stale = --muted, stroke/labels = --bg
const COLORS = { online: '#7C7DF5', stale: '#8B93A7', offline: '#5b6478', halo: '#7C5CFC' }

/** Course-rotatable arrow glyph drawn at runtime — no binary assets in the repo. */
function arrowImage(color: string): ImageData {
  const size = 44
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.translate(size / 2, size / 2)
  ctx.beginPath()
  ctx.moveTo(0, -16) // tip points north; icon-rotate applies `course` clockwise
  ctx.lineTo(11, 13)
  ctx.lineTo(0, 6)
  ctx.lineTo(-11, 13)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#0A0E1A'
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

/**
 * Full-bleed live map (spec §4): one clustered GeoJSON source fed by the liveStore's
 * 1 Hz flush — NO DOM markers (500 devices stay on the GPU). Selection halo is a
 * filter change, not a data rewrite.
 */
export function LiveMap() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new MlMap({
      container,
      style: STYLE_URL,
      center: VILNIUS,
      zoom: 11,
      // rule 13: OSM attribution visible on EVERY map view, never collapsed
      attributionControl: { compact: false, customAttribution: '© OpenStreetMap contributors' },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // e2e handle: lets Playwright assert RENDERED features (queryRenderedFeatures)
    // instead of guessing from canvas pixels
    ;(container as HTMLDivElement & { __map?: MlMap }).__map = map
    map.on('error', (e) => console.error('maplibre', e.error)) // degraded tiles must not crash the shell

    let disposed = false
    map.on('load', () => {
      if (disposed) return
      map.addImage('arrow-online', arrowImage(COLORS.online))
      map.addImage('arrow-stale', arrowImage(COLORS.stale))
      map.addImage('arrow-offline', arrowImage(COLORS.offline))

      map.addSource('devices', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
        promoteId: 'deviceId',
      })
      map.addSource('trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

      map.addLayer({
        id: 'trail-line',
        type: 'line',
        source: 'trail',
        filter: ['!=', ['get', 'gap'], true],
        paint: { 'line-color': COLORS.online, 'line-width': 1.5, 'line-opacity': 0.9 },
      })
      // I5 (E02-7, spec §4): no-fix stretches render as a dashed muted connector
      map.addLayer({
        id: 'trail-gap',
        type: 'line',
        source: 'trail',
        filter: ['==', ['get', 'gap'], true],
        paint: {
          'line-color': COLORS.stale,
          'line-width': 1.5,
          'line-opacity': 0.9,
          'line-dasharray': [2, 2],
        },
      })
      map.addLayer({
        id: 'selected-halo',
        type: 'circle',
        source: 'devices',
        filter: ['==', ['get', 'deviceId'], ''],
        paint: { 'circle-radius': 16, 'circle-color': COLORS.halo, 'circle-opacity': 0.35, 'circle-blur': 0.4 },
      })
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'devices',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': COLORS.online,
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 24],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0A0E1A',
        },
      })
      // count labels need glyphs; the offline dev/e2e style has none — clusters
      // still render as sized accent bubbles there
      if (map.getStyle().glyphs !== undefined) {
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'devices',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 11,
            'text-font': ['Noto Sans Regular'],
          },
          paint: { 'text-color': '#0A0E1A' },
        })
      }
      map.addLayer({
        id: 'device-arrows',
        type: 'symbol',
        source: 'devices',
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['concat', 'arrow-', ['get', 'status']],
          'icon-rotate': ['get', 'course'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-size': 0.6,
        },
      })

      map.on('click', 'device-arrows', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.['deviceId'] as string | undefined
        if (id !== undefined) liveStore.select(id)
      })
      map.on('click', 'clusters', (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0]
        const clusterId = feature?.properties?.['cluster_id'] as number | undefined
        const source = map.getSource<maplibregl.GeoJSONSource>('devices')
        if (clusterId === undefined || !source) return
        void source.getClusterExpansionZoom(clusterId).then((zoom: number) => {
          if (disposed) return // promise may outlive map.remove()
          if (feature?.geometry.type === 'Point') {
            map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom })
          }
        })
      })
      for (const layer of ['device-arrows', 'clusters']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
      }

      // store → map sink: setData at flush cadence (≤1 Hz), halo via setFilter
      liveStore.onMapFrame((frame: MapFrame) => {
        if (disposed) return
        const devices = map.getSource<maplibregl.GeoJSONSource>('devices')
        const trail = map.getSource<maplibregl.GeoJSONSource>('trail')
        devices?.setData(frame.devices)
        trail?.setData(frame.trail)
        map.setFilter('selected-halo', ['==', ['get', 'deviceId'], frame.selected?.deviceId ?? ''])
        if (frame.follow && frame.selected) {
          map.easeTo({ center: [frame.selected.lon, frame.selected.lat], duration: 900 })
        }
      })
    })

    return () => {
      disposed = true
      liveStore.onMapFrame(null)
      map.remove()
    }
  }, [])

  // NOT absolute/inset: maplibre-gl.css stamps `.maplibregl-map{position:relative}`
  // onto this very div and wins the cascade — with position:relative inset-0 sizes
  // to 0 height (found live: blank map, canvas 1200×0). Explicit h/w sidesteps it.
  return <div ref={containerRef} data-testid="live-map" className="h-full w-full" />
}
