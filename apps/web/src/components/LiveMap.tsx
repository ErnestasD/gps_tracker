import type { GeoJSONSource, Map as MbMap, MapMouseEvent } from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'

import { MapErrorOverlay } from '@/components/MapErrorOverlay'
import { liveStore, type MapFrame } from '@/lib/liveStore'
import { createThemedMap, mapboxgl, watchMapLoad } from '@/lib/map'

const VILNIUS: [number, number] = [25.2797, 54.6872]

// Device-marker palette: online = --accent, stale/offline stay muted but must remain LEGIBLE on the
// dark basemap (the old #5b6478 offline blended in — founder feedback). A white outline + soft shadow
// (in arrowImage) makes every state pop on both the dark and light navigation styles.
const COLORS = { online: '#7C7DF5', stale: '#B9C0D0', offline: '#8A93A6', halo: '#7C5CFC' }

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/**
 * Course-rotatable vehicle marker drawn at runtime — no binary assets in the repo. A filled
 * navigation pointer (tip north; icon-rotate applies `course` clockwise) with a soft drop shadow
 * for depth and a crisp white outline so it separates from ANY basemap instead of melting into it.
 */
function arrowImage(color: string): ImageData {
  const size = 48
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.translate(size / 2, size / 2)
  const pointer = () => {
    ctx.beginPath()
    ctx.moveTo(0, -18) // tip points north
    ctx.lineTo(12, 15)
    ctx.lineTo(0, 8) // concave tail → unambiguous heading
    ctx.lineTo(-12, 15)
    ctx.closePath()
  }
  // soft shadow under the filled body for depth on any tile colour
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 5
  ctx.shadowOffsetY = 1
  pointer()
  ctx.fillStyle = color
  ctx.fill()
  // crisp white outline on top (no shadow) — the key to legibility on dark OR light basemaps
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#ffffff'
  pointer()
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
  const [mapError, setMapError] = useState(false) // constructor threw / style never loaded

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { map, unsubscribe } = createThemedMap(container, { center: VILNIUS, zoom: 11 })
    const stopWatch = watchMapLoad(map, setMapError)
    if (map === null) {
      // missing token / WebGL failure — the overlay is up, nothing to wire
      return () => {
        stopWatch()
        unsubscribe()
      }
    }
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    // e2e handle: lets Playwright assert RENDERED features (queryRenderedFeatures)
    // instead of guessing from canvas pixels
    ;(container as HTMLDivElement & { __map?: MbMap }).__map = map
    map.on('error', (e) => console.error('mapbox', e.error)) // degraded tiles must not crash the shell

    let disposed = false
    let lastFrame: MapFrame | null = null // re-applied when a theme swap rebuilds the style

    // IDEMPOTENT setup (ADR-030): `style.load` fires for the initial style AND after
    // every theme `setStyle`, which drops ALL runtime images/sources/layers — re-add
    // everything, seeded from the last flushed frame so the swap is seamless.
    const setup = () => {
      if (disposed) return
      for (const [name, color] of [['arrow-online', COLORS.online], ['arrow-stale', COLORS.stale], ['arrow-offline', COLORS.offline]] as const) {
        if (!map.hasImage(name)) map.addImage(name, arrowImage(color))
      }
      if (map.getSource('devices')) return // sources/layers survived (no style swap)

      map.addSource('devices', {
        type: 'geojson',
        data: lastFrame?.devices ?? EMPTY_FC,
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
        promoteId: 'deviceId',
      })
      map.addSource('trail', { type: 'geojson', data: lastFrame?.trail ?? EMPTY_FC })

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
        filter: ['==', ['get', 'deviceId'], lastFrame?.selected?.deviceId ?? ''],
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
      if (map.getStyle()?.glyphs !== undefined) {
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'devices',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 11,
            // Mapbox-hosted font stack (docs.mapbox.com/mapbox-gl-js/example/cluster/)
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
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
          'icon-size': 0.62,
        },
      })
    }
    map.on('style.load', setup)

    // delegated layer handlers are keyed by layer id and evaluated at event time —
    // registered ONCE, they survive theme setStyle swaps (the ids never change)
    map.on('click', 'device-arrows', (e: MapMouseEvent) => {
      const id = e.features?.[0]?.properties?.['deviceId'] as string | undefined
      if (id !== undefined) liveStore.select(id)
    })
    map.on('click', 'clusters', (e: MapMouseEvent) => {
      const feature = e.features?.[0]
      const clusterId = feature?.properties?.['cluster_id'] as number | undefined
      const source = map.getSource<GeoJSONSource>('devices')
      if (clusterId === undefined || !source) return
      // mapbox-gl uses the callback form here (not a Promise)
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (disposed || err || zoom == null) return // callback may outlive map.remove()
        if (feature?.geometry.type === 'Point') {
          map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom })
        }
      })
    })
    for (const layer of ['device-arrows', 'clusters']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }

    // store → map sink: setData at flush cadence (≤1 Hz), halo via setFilter.
    // Guards tolerate the brief window while a theme swap rebuilds the style.
    liveStore.onMapFrame((frame: MapFrame) => {
      if (disposed) return
      lastFrame = frame
      map.getSource<GeoJSONSource>('devices')?.setData(frame.devices)
      map.getSource<GeoJSONSource>('trail')?.setData(frame.trail)
      if (map.getLayer('selected-halo')) {
        map.setFilter('selected-halo', ['==', ['get', 'deviceId'], frame.selected?.deviceId ?? ''])
      }
      if (frame.follow && frame.selected) {
        map.easeTo({ center: [frame.selected.lon, frame.selected.lat], duration: 900 })
      }
    })

    return () => {
      disposed = true
      liveStore.onMapFrame(null)
      stopWatch()
      unsubscribe()
      map.remove()
    }
  }, [])

  // map div NOT absolute/inset: mapbox-gl.css stamps `.mapboxgl-map{position:relative}`
  // onto it and wins the cascade — with position:relative inset-0 sizes to 0 height
  // (found live: blank map, canvas 1200×0). Explicit h/w sidesteps it; the relative
  // wrapper only anchors the error overlay.
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-testid="live-map" className="h-full w-full" />
      <MapErrorOverlay show={mapError} testId="live-map-error" variant="shell" />
    </div>
  )
}
