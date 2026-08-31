import type { GeoJSONSource, Map as MbMap, MapMouseEvent } from 'mapbox-gl'
import { Crosshair, MapPin, ZoomIn, ZoomOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MapErrorOverlay } from '@/components/MapErrorOverlay'
import { liveStore, scrubFeatures, type MapFrame, type ScrubState } from '@/lib/liveStore'
import { filterMarkers, type FleetFilter } from '@/lib/fleetFilter'
import { createThemedMap, mapboxgl, watchMapLoad } from '@/lib/map'
import type { MapLayers } from '@/lib/mapLayers'

const VILNIUS: [number, number] = [25.2797, 54.6872]

// Device-marker palette: online = --accent, stale/offline stay muted but must remain LEGIBLE on the
// dark basemap (the old #5b6478 offline blended in — founder feedback). A white outline + soft shadow
// (in arrowImage) makes every state pop on both the dark and light navigation styles.
const COLORS = { online: '#7C7DF5', stale: '#B9C0D0', offline: '#8A93A6', halo: '#7C5CFC', history: '#F2A93B' }

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
 *
 * Everything optional is a LAYER the operator switches on: geofences, name labels, the density
 * overlay and the selected vehicle's 24-hour track. They are separate sources so a toggle is a
 * visibility change rather than a data rebuild, and so a heavy one (a fleet's worth of zones) costs
 * nothing while it is off.
 */
export function LiveMap({
  layers,
  geofences = EMPTY_FC,
  history = EMPTY_FC,
  labelOf,
  hasSelection = false,
  statusFilter = 'all',
}: {
  layers: MapLayers
  /** Geofence polygons the operator has left visible (already filtered by the workspace). */
  geofences?: GeoJSON.FeatureCollection
  /** The selected device's 24-hour track, split into solid runs and dashed no-fix connectors. */
  history?: GeoJSON.FeatureCollection
  /** deviceId → the label drawn beside the marker when the "names" layer is on. */
  labelOf?: (deviceId: string) => string
  /** Whether a vehicle is selected — "centre on selected" is a no-op without one, and a control
   *  that silently does nothing teaches the operator to distrust the others. */
  hasSelection?: boolean
  /**
   * The workspace's status filter, applied to the MARKERS too.
   *
   * It used to narrow only the fleet list, so filtering to "Offline" left every vehicle on the map
   * and the operator reading a list of four against a map of ten. The filter is applied to the
   * SOURCE DATA rather than as a layer filter, because this source clusters: a layer filter hides
   * the arrows but the cluster bubbles keep counting what it hid, so "2" would sit over a map
   * showing nothing.
   *
   * `silent` devices have never reported a position and therefore have no marker at all — that
   * filter empties the map, correctly and by construction.
   */
  statusFilter?: FleetFilter
}) {
  const { t } = useTranslation()
  // The map sink is registered once; like `labelOf` the filter has to reach it through a ref, or
  // the closure would keep filtering by whatever was selected on first render.
  const statusFilterRef = useRef<FleetFilter>(statusFilter)
  statusFilterRef.current = statusFilter
  // …and the store must re-send the frame, or a filter change over a parked fleet would not repaint
  // until some vehicle reported.
  useEffect(() => {
    liveStore.repaintMap()
  }, [statusFilter])
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MbMap | null>(null)
  const [mapError, setMapError] = useState(false) // constructor threw / style never loaded
  // Props read inside the map's own callbacks, which are registered once and must not close over a
  // stale render. A ref keeps them current without tearing down the map on every keystroke.
  const labelRef = useRef(labelOf)
  const layersRef = useRef(layers)
  const dataRef = useRef({ geofences, history })
  // Written in a layout effect, not in the render body: a render React throws away must not commit
  // its value into a ref that a once-registered map callback will later read.
  useLayoutEffect(() => {
    labelRef.current = labelOf
    layersRef.current = layers
    dataRef.current = { geofences, history }
  })
  const applyRef = useRef<{ layers: () => void; data: () => void } | null>(null)
  /** The device points of the last flushed frame — what "fit the whole fleet" has to frame. */
  const pointsRef = useRef<GeoJSON.Feature[]>([])

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
    mapRef.current = map
    // e2e handle: lets Playwright assert RENDERED features (queryRenderedFeatures)
    // instead of guessing from canvas pixels
    ;(container as HTMLDivElement & { __map?: MbMap }).__map = map
    map.on('error', (e) => console.error('mapbox', e.error)) // degraded tiles must not crash the shell

    let disposed = false
    let lastFrame: MapFrame | null = null // re-applied when a theme swap rebuilds the style
    /**
     * The collection the source actually holds — the JOINED one, with labels.
     *
     * Seeding a rebuilt style from `lastFrame.devices` (the store's raw collection) dropped every
     * device name, and `flush` early-returns when nothing changed, so on a quiet or paused map the
     * labels stayed blank until the next position arrived.
     */
    let lastDevicesJoined: GeoJSON.FeatureCollection | null = null
    let lastDevicesRaw: GeoJSON.FeatureCollection | null = null
    let lastTrail: GeoJSON.FeatureCollection | null = null
    let lastLabelFn: ((id: string) => string) | undefined
    let lastStatusFilter: FleetFilter | null = null
    /** The last scrub PLACE SEEN — not necessarily where the camera is: the first frame after
     *  registration records the place without moving, so a remount does not fly into a scrub the
     *  operator left behind. '' when live, and when we hold no position for the moment. */
    let lastScrubKey = ''
    /** The ghost's own collection, so a theme swap re-seeds it like every other source. */
    let lastScrubFC: GeoJSON.FeatureCollection = EMPTY_FC
    /** No frame seen yet. A SYMBOL, not `undefined`: the no-frame sentinel must be a value that
     *  `ScrubState` can never grow into — it has already gone from two states to three. */
    const NO_FRAME = Symbol('no-frame')
    let lastScrubData: ScrubState | typeof NO_FRAME = NO_FRAME
    /** NO_FRAME so a remount with a selection already made is recognised as the INITIAL frame:
     *  a fresh map always opens on the default city view, and if the store still holds a
     *  selection (it outlives this page), showing the inspector for one place while the camera
     *  sits on another reads as "the map is wrong". The initial frame therefore centres on the
     *  selection too — with a jump, not a fly, because there is no prior view to fly from. */
    let lastSelectedId: string | null | typeof NO_FRAME = NO_FRAME
    /** The selection's fix can lag the first frame (the position snapshot seeds async): keep the
     *  initial centring pending until the fix exists, and drop it the moment the operator pans. */
    let initialCenterPending = false
    map.on('dragstart', () => { initialCenterPending = false })

    // IDEMPOTENT setup (ADR-030): `style.load` fires for the initial style AND after
    // every theme `setStyle`, which drops ALL runtime images/sources/layers — re-add
    // everything, seeded from the last flushed frame so the swap is seamless.
    const setup = () => {
      if (disposed) return
      for (const [name, color] of [['arrow-online', COLORS.online], ['arrow-stale', COLORS.stale], ['arrow-offline', COLORS.offline], ['arrow-scrub', COLORS.history]] as const) {
        if (!map.hasImage(name)) map.addImage(name, arrowImage(color))
      }
      if (map.getSource('devices')) return // sources/layers survived (no style swap)

      map.addSource('devices', {
        type: 'geojson',
        data: lastDevicesJoined ?? lastFrame?.devices ?? EMPTY_FC,
        cluster: true,
        clusterRadius: 50,
        clusterMaxZoom: 14,
        promoteId: 'deviceId',
      })
      map.addSource('trail', { type: 'geojson', data: lastFrame?.trail ?? EMPTY_FC })
      map.addSource('geofences', { type: 'geojson', data: EMPTY_FC })
      map.addSource('history', { type: 'geojson', data: EMPTY_FC })
      map.addSource('scrub', { type: 'geojson', data: lastScrubFC })

      // Zones sit UNDER everything else: they are context, and a filled polygon painted over the
      // vehicle it contains hides the thing the operator is looking for.
      map.addLayer({
        id: 'geofence-fill',
        type: 'fill',
        source: 'geofences',
        paint: { 'fill-color': ['coalesce', ['get', 'color'], COLORS.halo], 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: 'geofence-line',
        type: 'line',
        source: 'geofences',
        paint: {
          'line-color': ['coalesce', ['get', 'color'], COLORS.halo],
          'line-width': 1.5,
          'line-dasharray': [3, 2],
        },
      })
      /**
       * The density overlay answers "where does this fleet actually spend its time".
       *
       * Weighted by `point_count`, because the source clusters: without it a bubble standing for
       * forty vehicles counts exactly as much as one parked van, and the picture inverts — the
       * emptiest part of the map glows brightest.
       */
      map.addLayer({
        id: 'device-heat',
        type: 'heatmap',
        source: 'devices',
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['coalesce', ['get', 'point_count'], 1],
          'heatmap-radius': 40,
          'heatmap-opacity': 0.55,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(124,125,245,0)',
            0.4, 'rgba(124,125,245,0.5)',
            1, '#F2A93B',
          ],
        },
      })
      map.addLayer({
        id: 'history-line',
        type: 'line',
        source: 'history',
        filter: ['!=', ['get', 'gap'], true],
        paint: { 'line-color': COLORS.history, 'line-width': 2.5, 'line-opacity': 0.85 },
      })
      // I5, on the read side: a no-fix stretch is drawn as a dashed connector rather than as a
      // straight run the vehicle never drove
      map.addLayer({
        id: 'history-gap',
        type: 'line',
        source: 'history',
        filter: ['==', ['get', 'gap'], true],
        paint: { 'line-color': COLORS.stale, 'line-width': 1.5, 'line-opacity': 0.7, 'line-dasharray': [2, 2] },
      })
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
      if (map.getStyle()?.glyphs !== undefined) {
        map.addLayer({
          id: 'device-labels',
          type: 'symbol',
          source: 'devices',
          filter: ['!', ['has', 'point_count']],
          layout: {
            visibility: 'none',
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-offset': [0, 1.4],
            'text-anchor': 'top',
            'text-optional': true,
          },
          paint: { 'text-color': '#E6E9F2', 'text-halo-color': '#0A0E1A', 'text-halo-width': 1.2 },
        })
      }
      /**
       * Where the vehicle WAS at the scrubbed moment — added LAST, so both halves sit above every
       * live-fleet layer including the name labels.
       *
       * The camera moving there was not enough: the fleet's markers are the LIVE frame, so sliding
       * back in time panned the map to an empty patch of road while the vehicle's own arrow stayed
       * at its present position. Drawn in the history colour — the same one the 24-hour track uses —
       * so it reads as "then", not as a second vehicle. The halo used to sit below the cluster
       * bubbles, and the scrub eases the ghost to the viewport centre, which is exactly where a
       * dense city fleet puts a bubble: for a record with no heading the halo is the only mark, and
       * it was painted over — the original report, reproduced.
       */
      map.addLayer({
        id: 'scrub-halo',
        type: 'circle',
        source: 'scrub',
        paint: { 'circle-radius': 18, 'circle-color': COLORS.history, 'circle-opacity': 0.28, 'circle-blur': 0.35 },
      })
      map.addLayer({
        id: 'scrub-arrow',
        type: 'symbol',
        source: 'scrub',
        // Only where the record carried a heading. Rotating by a defaulted 0 would point the ghost
        // due north and call it the direction of travel — the same manufactured heading the
        // inspector was fixed for.
        filter: ['==', ['get', 'hasCourse'], true],
        layout: {
          'icon-image': 'arrow-scrub',
          'icon-rotate': ['get', 'course'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': 0.7,
        },
      })
      applyLayers()
      applyExtraData()
    }

    // Visibility + extra-source data are re-applied after every style swap, because `setStyle`
    // drops both. They read from refs so the listeners never go stale.
    const applyLayers = () => {
      const l = layersRef.current
      const vis = (id: string, on: boolean) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
      }
      vis('geofence-fill', l.geofences)
      vis('geofence-line', l.geofences)
      vis('device-heat', l.heat)
      vis('device-labels', l.labels)
      vis('history-line', l.trails)
      vis('history-gap', l.trails)
      vis('trail-line', l.trails)
      vis('trail-gap', l.trails)
    }
    const applyExtraData = () => {
      map.getSource<GeoJSONSource>('geofences')?.setData(dataRef.current.geofences)
      map.getSource<GeoJSONSource>('history')?.setData(dataRef.current.history)
    }
    applyRef.current = { layers: applyLayers, data: applyExtraData }
    map.on('style.load', setup)

    // delegated layer handlers are keyed by layer id and evaluated at event time —
    // registered ONCE, they survive theme setStyle swaps (the ids never change)
    map.on('click', 'device-arrows', (e: MapMouseEvent) => {
      const feature = e.features?.[0]
      const id = feature?.properties?.['deviceId'] as string | undefined
      if (id === undefined) return
      liveStore.select(id)
      // a tapped vehicle comes to the operator: centre it and step in — but never zoom OUT
      // from a view the operator already framed (same rule as the centre-selected control)
      if (feature?.geometry.type === 'Point') {
        map.easeTo({
          center: feature.geometry.coordinates as [number, number],
          zoom: Math.max(map.getZoom(), 14),
          duration: 600,
        })
      }
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
      /**
       * Nothing is re-uploaded unless it changed.
       *
       * The store hands out the SAME collection object when only the scrub moved — and a scrub
       * moves dozens of times a second on a drag. Re-joining labels and calling `setData` on a
       * clustered source re-indexes the whole supercluster in the worker each time, which threw
       * away the exact saving the store's cache exists to make. Identity is the signal; the label
       * function is part of it, because renaming a device must still redraw its label.
       */
      const label = labelRef.current
      const statusF = statusFilterRef.current
      if (frame.devices !== lastDevicesRaw || label !== lastLabelFn || statusF !== lastStatusFilter) {
        lastDevicesRaw = frame.devices
        lastLabelFn = label
        lastStatusFilter = statusF
        const kept = filterMarkers(frame.devices.features, statusF)
        // The name label lives in the FEATURE, because a symbol layer can only read what the source
        // carries. Joining it here rather than in the store keeps the store free of view concerns.
        lastDevicesJoined =
          label === undefined
            ? { type: 'FeatureCollection', features: kept }
            : {
                type: 'FeatureCollection',
                features: kept.map((f) => ({
                  ...f,
                  properties: { ...f.properties, label: label(String(f.properties?.['deviceId'] ?? '')) },
                })),
              }
        pointsRef.current = lastDevicesJoined.features.filter((f) => f.geometry.type === 'Point')
        map.getSource<GeoJSONSource>('devices')?.setData(lastDevicesJoined)
      }
      if (frame.trail !== lastTrail) {
        lastTrail = frame.trail
        map.getSource<GeoJSONSource>('trail')?.setData(frame.trail)
      }
      if (map.getLayer('selected-halo')) {
        map.setFilter('selected-halo', ['==', ['get', 'deviceId'], frame.selected?.deviceId ?? ''])
      }
      /**
       * A NEW selection centres the camera, whatever selected it — marker tap, fleet-list row,
       * search. The store is where those paths converge, so the camera reacts to the frame rather
       * than to each widget. Zoom steps IN to street level but never OUT of a view the operator
       * already framed (the centre-selected control's rule); a device with no valid fix has no
       * place to centre on, and deselecting moves nothing.
       */
      const selId = frame.selected?.deviceId ?? null
      if (lastSelectedId === NO_FRAME) initialCenterPending = selId !== null
      if (selId === null) initialCenterPending = false
      if (initialCenterPending && frame.selectedFix) {
        initialCenterPending = false
        map.jumpTo({ center: [frame.selectedFix.lon, frame.selectedFix.lat], zoom: Math.max(map.getZoom(), 14) })
      } else if (lastSelectedId !== NO_FRAME && selId !== null && selId !== lastSelectedId && frame.selectedFix) {
        map.easeTo({
          center: [frame.selectedFix.lon, frame.selectedFix.lat],
          zoom: Math.max(map.getZoom(), 14),
          duration: 600,
        })
      }
      lastSelectedId = selId
      /**
       * ONE detector for "the value changed", nested inside it one for "the place changed".
       *
       * There used to be two parallel detectors over the same value — an object-identity one for
       * the ghost and a `lon,lat` string one for the camera — and that duplication WAS the bug:
       * they disagreed whenever two moments shared a coordinate with different headings, which is
       * the ordinary case for a parked vehicle, and the ghost's arrow kept whichever way it faced
       * when the scrub first landed there. Nested, they cannot disagree: if the value did not
       * change, the place cannot have.
       *
       * `setScrub` early-returns on an unchanged value, so identity changes exactly when the value
       * does — heading included — and the first frame after registration is a change like any other
       * (the CAMERA is what must skip it, so a remount does not fly into a scrub left behind).
       */
      if (frame.scrub !== lastScrubData) {
        const first = lastScrubData === NO_FRAME
        lastScrubData = frame.scrub
        lastScrubFC = scrubFeatures(frame.scrub)
        map.getSource<GeoJSONSource>('scrub')?.setData(lastScrubFC)

        /**
         * Camera moves happen on a change of PLACE, never on every frame.
         *
         * `frame.scrub` holds the same point across every 1 Hz flush, and re-issuing `easeTo` each
         * second made the map snap back a second after the operator panned it — unpannable for as
         * long as a moment was selected, with nothing on screen saying why. A heading change at the
         * same coordinate is a new ghost but not a new place.
         */
        const scrubKey = frame.scrub === null || frame.scrub === 'unknown' ? '' : `${frame.scrub.lon},${frame.scrub.lat}`
        if (frame.scrub !== null && frame.scrub !== 'unknown' && !first && scrubKey !== lastScrubKey) {
          map.easeTo({ center: [frame.scrub.lon, frame.scrub.lat], duration: 400 })
        }
        lastScrubKey = scrubKey
      }
      /**
       * Scrubbing wins over following: the operator asked to look at a moment in the past, and the
       * vehicle's present position is not what they are reading. `'unknown'` is a scrub too — we
       * hold no position for that moment, so the camera HOLDS rather than flying to the present.
       */
      if (frame.scrub === null && frame.follow && frame.selectedFix) {
        // follow the last VALID fix; a device that has never had one is not on the map to follow
        map.easeTo({ center: [frame.selectedFix.lon, frame.selectedFix.lat], duration: 900 })
      }
    })

    /**
     * Mapbox GL does not watch its own container.
     *
     * `_onWindowResize` is bound to `window: resize`, `orientationchange` and the Fullscreen API —
     * nothing else. That was harmless while the panels floated ABOVE a full-bleed map, and became a
     * visible defect the moment they were docked as flex siblings: selecting a vehicle takes 340px
     * for the inspector rail, the WebGL canvas keeps its old width, the right edge is clipped, and
     * every `easeTo(center)` — follow, cluster zoom, the timeline scrub — lands off-centre because
     * the visual centre is no longer the geographic one. The CSS "full screen" button is not the
     * Fullscreen API either, so it fires no event at all. One observer covers every dock, present
     * and future.
     */
    /**
     * Loop-proofed on purpose. `map.resize()` writes to the canvas inside the observed element, and
     * a ResizeObserver that reacts to a size IT caused spins the callback forever — in a headless
     * browser that pegs the CPU and every later assertion simply times out, which is a far worse
     * failure than a wrong layout. So: ignore a notification that reports the size we already have,
     * and coalesce the rest into one resize per frame.
     */
    let lastW = container.clientWidth
    let lastH = container.clientHeight
    let raf = 0
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        map.resize()
      })
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      mapRef.current = null
      applyRef.current = null
      if (raf !== 0) cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      liveStore.onMapFrame(null)
      stopWatch()
      unsubscribe()
      map.remove()
    }
  }, [])

  // ── prop → map plumbing ──────────────────────────────────────────────────
  useEffect(() => {
    applyRef.current?.layers()
  }, [layers])
  useEffect(() => {
    applyRef.current?.data()
  }, [geofences, history])

  const zoomBy = (dir: 1 | -1) => {
    const map = mapRef.current
    if (map === null) return
    map.easeTo({ zoom: map.getZoom() + dir, duration: 250 })
  }

  /** Frame the whole fleet — the answer to "where is everyone" after zooming into one vehicle. */
  const fitAll = () => {
    const map = mapRef.current
    const points = pointsRef.current
    if (map === null || points.length === 0) return
    const bounds = new mapboxgl.LngLatBounds()
    for (const f of points) bounds.extend((f.geometry as GeoJSON.Point).coordinates as [number, number])
    map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 600 })
  }

  const centerSelected = () => {
    const map = mapRef.current
    const fix = liveStore.selectedFix()
    if (map === null || fix === null) return
    map.easeTo({ center: [fix.lon, fix.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 })
  }

  // map div NOT absolute/inset: mapbox-gl.css stamps `.mapboxgl-map{position:relative}`
  // onto it and wins the cascade — with position:relative inset-0 sizes to 0 height
  // (found live: blank map, canvas 1200×0). Explicit h/w sidesteps it; the relative
  // wrapper only anchors the error overlay.
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-testid="live-map" className="h-full w-full" />

      <div className="absolute right-2 top-2 flex flex-col gap-1.5 md:right-3 md:top-3">
        <MapCtl onClick={() => zoomBy(1)} label={t('map.ctl.zoomIn')} testId="map-zoom-in">
          <ZoomIn className="h-4 w-4" aria-hidden />
        </MapCtl>
        <MapCtl onClick={() => zoomBy(-1)} label={t('map.ctl.zoomOut')} testId="map-zoom-out">
          <ZoomOut className="h-4 w-4" aria-hidden />
        </MapCtl>
        <MapCtl onClick={fitAll} label={t('map.ctl.fitAll')} testId="map-fit-all">
          <Crosshair className="h-4 w-4" aria-hidden />
        </MapCtl>
        <MapCtl
          onClick={centerSelected}
          label={t('map.ctl.centerSelected')}
          testId="map-center-selected"
          disabled={!hasSelection}
        >
          <MapPin className="h-4 w-4" aria-hidden />
        </MapCtl>
      </div>

      {/* Legend: the marker colours mean something, and a colour whose meaning lives only in a
          spec is decoration. Hidden on phones, where the map itself is the scarce resource. */}
      <div
        className="absolute bottom-3 left-3 hidden gap-3 rounded-card border border-line bg-surface/90 px-3 py-2 shadow-card backdrop-blur lg:flex"
        data-testid="map-legend"
      >
        {(['online', 'stale', 'offline'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[s] }} />
            {t(`status.${s}`)}
          </span>
        ))}
      </div>

      <MapErrorOverlay show={mapError} testId="live-map-error" variant="shell" />
    </div>
  )
}

function MapCtl({
  children,
  onClick,
  label,
  testId,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  label: string
  testId: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="grid h-8 w-8 place-items-center rounded-md border border-line bg-surface/90 text-text shadow-card backdrop-blur transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
