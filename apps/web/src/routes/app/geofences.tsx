import type { GeofenceView } from '@orbetra/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle as CircleIcon, Hexagon, MousePointerClick, Pencil, Route as RouteIcon, Search, Trash2, X } from 'lucide-react'
import type { GeoJSONSource, Map as MbMap } from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminInput, AdminLabel, AdminRadio, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { MapErrorOverlay } from '@/components/MapErrorOverlay'
import { getCurrentUser } from '@/lib/auth'
import { useFmt } from '@/lib/datetime'
import { ApiError } from '@/lib/http'
import { createGeofence, deleteGeofence, geofenceBounds, geofenceFeatures, listGeofences, updateGeofence } from '@/lib/geofences'
import { createThemedMap, mapboxgl, watchMapLoad } from '@/lib/map'

const VILNIUS: [number, number] = [25.2797, 54.6872]

type Drawn = { geometry: GeoJSON.Geometry; kind: 'polygon' | 'circle' | 'corridor' } | null
type DraftKind = 'polygon' | 'circle' | 'corridor'

/** Close the polygon by clicking back on the FIRST vertex — within this many screen px. */
const CLOSE_PX = 12

/** kind → list-row icon (Lovable app.geofences idiom: tinted chip per shape kind). */
const KIND_ICON = { polygon: Hexagon, circle: CircleIcon, corridor: RouteIcon } as const

/** Curated swatch palette (reference COLORS): the draft color picker is a row of round
 * swatches, not a native color input (round-2 control sweep). */
const COLORS = ['#4F46E5', '#059669', '#B45309', '#E11D48', '#0284C7', '#7C3AED']

// ── the drawing toolkit (founder: the previous library editor "buginasi") ─────
// Two clicks, live preview: click the CENTRE, move to see the circle grow with a radius
// label under the cursor, click again to fix the edge. The radius stays editable as a
// number afterwards. Hand-rolled on plain map events — no drawing library at all.

const EARTH_R = 6_371_000
const CIRCLE_STEPS = 64
const MIN_RADIUS_M = 10
const MAX_RADIUS_M = 50_000

function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Geodesic circle as a closed polygon ring (destination-point formula per bearing step). */
function circlePolygon(center: [number, number], radiusM: number): GeoJSON.Polygon {
  const [lon, lat] = center
  const φ1 = (lat * Math.PI) / 180
  const λ1 = (lon * Math.PI) / 180
  const δ = radiusM / EARTH_R
  const ring: [number, number][] = []
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    const θ = (i / CIRCLE_STEPS) * 2 * Math.PI
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

/** A point `radiusM` due EAST of `center` — the grip you drag to resize a circle. */
function dueEast(center: [number, number], radiusM: number): [number, number] {
  const ring = circlePolygon(center, radiusM).coordinates[0]!
  return ring[Math.round(CIRCLE_STEPS / 4)] as [number, number]
}

/**
 * Recover a circle's centre and radius from the ring we stored for it.
 *
 * `geofences.geom` is `geography(Polygon,4326)` — a circle is persisted as its polygon and nothing
 * else, so re-opening one for editing means reading the shape back out. `circlePolygon` walks
 * evenly-spaced bearings, so the vertex centroid IS the centre and every vertex is one radius away;
 * averaging both is exact to floating point rather than an approximation.
 *
 * A corridor cannot be recovered this way and deliberately is not tried: its centre-line is never
 * stored, only the buffered polygon, so there is nothing to read back. See ADR-040.
 */
function circleFromRing(pts: readonly [number, number][]): { center: [number, number]; radiusM: number } {
  const n = Math.max(1, pts.length)
  const center: [number, number] = [
    pts.reduce((a, p) => a + (p[0] ?? 0), 0) / n,
    pts.reduce((a, p) => a + (p[1] ?? 0), 0) / n,
  ]
  const radiusM = pts.reduce((a, p) => a + haversineM(center, p), 0) / n
  return { center, radiusM }
}

/** The ring of an existing zone, closing duplicate dropped, or null if it is not a polygon. */
function ringOf(geometry: unknown): [number, number][] | null {
  const g = geometry as { type?: string; coordinates?: unknown }
  if (g?.type !== 'Polygon' || !Array.isArray(g.coordinates)) return null
  const ring = g.coordinates[0] as unknown
  if (!Array.isArray(ring) || ring.length < 4) return null
  return (ring.slice(0, -1) as number[][]).map((p) => [p[0]!, p[1]!])
}

const fmtRadius = (m: number): string => (m >= 1_000 ? `${(m / 1_000).toFixed(2)} km` : `${Math.round(m)} m`)

/**
 * Does the ring cross itself?
 *
 * Dragging a corner past its neighbours makes a bow-tie, and PostGIS refuses it — but only at SAVE,
 * behind the shared "invalid or too large" message, which tells an operator nothing about the shape
 * they are looking at. O(n²) over a hand-drawn ring is nothing, and it lets the outline say so while
 * the corner is still under the cursor.
 */
function selfIntersects(pts: readonly [number, number][]): boolean {
  const n = pts.length
  if (n < 4) return false
  const side = (a: readonly number[], b: readonly number[], c: readonly number[]): number =>
    Math.sign((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!))
  const crosses = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean =>
    side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // edges sharing a vertex always "touch" — only non-adjacent pairs can be a crossing
      if ((j + 1) % n === i || (i + 1) % n === j) continue
      if (crosses(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) return true
    }
  }
  return false
}

/** An existing zone opened for VERTEX editing. Parallel to the drawing tool — never both at once. */
type EditShape =
  | { kind: 'polygon'; pts: [number, number][] }
  | { kind: 'circle'; center: [number, number]; radiusM: number }
/** Grab tolerance for a handle, in screen px — generous, because these are dragged not clicked. */
const GRAB_PX = 11

/** Geofences (E05-1): draw circle/polygon/corridor with the in-house tool, save, list, delete.
 *  Corridor (V2): draw a route LineString + a buffer half-width; the server buffers it to a polygon.
 *  Round 2 (ADR-028, verify sweep): the add form follows the reference draft-panel idiom — the
 *  header mode buttons enter DRAFT mode (a Sheet would cover the map the user must draw on);
 *  while drafting the aside swaps from the list to the DraftPanel (name/type/color/buffer) and
 *  the header shows Cancel/Save. The list gains search + row selection (highlight + map fit +
 *  floating detail card). Delete goes through a danger ConfirmDialog. */
export function GeofencesPage() {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const qc = useQueryClient()
  // geofence writes require account_manager+ (WRITE_POLICY.geofence) — hide draw/save/delete from
  // viewers (reads stay open); matches the drivers/maintenance canWrite precedent
  const canWrite = ['platform_admin', 'tsp_admin', 'account_manager'].includes(getCurrentUser()?.role ?? '')
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: listGeofences })
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MbMap | null>(null)
  // bumps on EVERY style.load (initial + theme swaps, ADR-030) so the geofence
  // features get re-applied to the freshly rebuilt (empty) source
  const [styleEpoch, setStyleEpoch] = useState(0)
  const [mapError, setMapError] = useState(false) // constructor threw / style never loaded
  const [drawn, setDrawn] = useState<Drawn>(null)
  const [draftKind, setDraftKind] = useState<DraftKind | null>(null) // non-null = draft mode
  /** circle metadata: centre chosen, radius editable after the second click */
  const [circleMeta, setCircleMeta] = useState<{ center: [number, number]; radiusM: number } | null>(null)
  const [radiusLabel, setRadiusLabel] = useState<{ x: number; y: number; text: string } | null>(null)
  /** THE drawing tool. One state machine for all three kinds (founder: the shapes must feel
   *  identical): `tool` = armed kind, `center` = circle centre, `pts` = polygon/corridor vertices. */
  const toolRef = useRef<{ tool: DraftKind | null; center: [number, number] | null; pts: [number, number][] }>({ tool: null, center: null, pts: [] })
  /** The zone being vertex-edited. `toolRef.tool` is null whenever this is set, and vice versa —
   *  arming a drawing tool REPLACES the shape, editing MUTATES it. */
  const editRef = useRef<EditShape | null>(null)
  const dragRef = useRef<{ kind: 'vertex'; i: number } | { kind: 'center' } | { kind: 'radius' } | null>(null)
  /** set inside the map effect so `startEdit`, which lives outside it, can repaint the handles */
  const renderEditRef = useRef<() => void>(() => {})
  const draftColorRef = useRef(COLORS[0]!)
  const bufferMRef = useRef(100)
  const setDraftRef = useRef<(features: GeoJSON.Feature[]) => void>(() => {})
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0]!)
  const [bufferM, setBufferM] = useState(100) // corridor half-width in metres (10 … 5000)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('') // list search (client-side — the full list is already loaded)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState(false) // surfaces a failed delete (was swallowed)
  const [saving, setSaving] = useState(false) // in-flight guard for the create POST (no double-submit)
  // delete target resolves against the LIVE list (devices precedent) — a refetch never
  // leaves the confirm pointed at a stale snapshot
  const [deleteForId, setDeleteForId] = useState<string | null>(null)
  /** non-null = DRAFT mode is EDITING this zone (rename/recolor, optional redraw) rather than
   *  creating a new one — the same panel, so the drawing tools stay one flow */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** handles are on the map and draggable — false while EDITING a corridor, which redraws */
  const [reshaping, setReshaping] = useState(false)
  /** the drafted ring crosses itself — PostGIS would refuse it, so say so before Save does */
  const [shapeInvalid, setShapeInvalid] = useState(false)
  const deleteFor = (geofences.data ?? []).find((g) => g.id === deleteForId) ?? null
  const selected = (geofences.data ?? []).find((g) => g.id === selectedId) ?? null

  const drawnRef = useRef<Drawn>(null)
  const updateDrawn = (d: Drawn) => { drawnRef.current = d; setDrawn(d) }
  useEffect(() => { bufferMRef.current = bufferM }, [bufferM])
  // Escape wipes the in-progress sketch (vertices placed so far) but stays in draft mode —
  // the standard drawing-tool contract
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const st = toolRef.current
      if (st.tool === null || (st.center === null && st.pts.length === 0)) return
      toolRef.current = { tool: st.tool, center: null, pts: [] }
      setCircleMeta(null)
      setRadiusLabel(null)
      setDraftRef.current([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // map + drawing-tool lifecycle
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { map, unsubscribe } = createThemedMap(container, { center: VILNIUS, zoom: 10 })
    // 8s watchdog: blocked tile CDN / offline / WebGL failure / bad token — surface it
    // instead of leaving the polygon/circle buttons silently dead (clears on style.load)
    const stopWatch = watchMapLoad(map, setMapError)
    if (map === null) {
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

    // ── the drawing engine: ONE set of handlers for circle / polygon / corridor ──
    const featureFor = (geometry: GeoJSON.Geometry, invalid = false): GeoJSON.Feature =>
      ({ type: 'Feature', geometry, properties: { color: draftColorRef.current, invalid } })
    /**
     * `anchor` marks the vertex that ENDS the shape, `armed` whether clicking it would work yet.
     *
     * A polygon closes by clicking back on its first vertex, and every vertex was drawn
     * identically — on a shape with a dozen points there was nothing to aim at (founder report).
     * Only the polygon gets an anchor: the corridor ends on a double-click and the circle's single
     * point is its centre, so marking either would advertise a click that does nothing.
     */
    const vertexFeatures = (
      pts: readonly [number, number][],
      opts?: { closesRing?: boolean; armed?: boolean },
    ): GeoJSON.Feature[] =>
      pts.map((pt, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pt },
        properties: {
          color: draftColorRef.current,
          anchor: opts?.closesRing === true && i === 0,
          armed: opts?.armed === true && i === 0,
        },
      }))
    const setDraft = (features: GeoJSON.Feature[]) => {
      map.getSource<GeoJSONSource>('gf-draft')?.setData({ type: 'FeatureCollection', features })
    }
    ;(setDraftRef as { current: typeof setDraft }).current = setDraft

    /** live preview for the CURRENT sketch, with the cursor as the tentative next vertex */
    const preview = (cursor: [number, number] | null) => {
      const st = toolRef.current
      if (st.tool === 'circle') {
        if (st.center === null) return
        const r = cursor === null ? MIN_RADIUS_M : Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, haversineM(st.center, cursor)))
        setDraft([featureFor(circlePolygon(st.center, r)), ...vertexFeatures([st.center])])
        return
      }
      if (st.pts.length === 0) return
      const pts = cursor === null ? st.pts : [...st.pts, cursor]
      if (st.tool === 'polygon') {
        const geometry: GeoJSON.Geometry = pts.length >= 3
          ? { type: 'Polygon', coordinates: [[...pts, pts[0]!]] }
          : { type: 'LineString', coordinates: pts }
        setDraft([featureFor(geometry), ...vertexFeatures(st.pts, { closesRing: true, armed: st.pts.length >= 3 })])
      } else {
        setDraft([featureFor({ type: 'LineString', coordinates: pts }), ...vertexFeatures(st.pts)])
      }
    }

    const finishSketch = () => {
      const st = toolRef.current
      if (st.tool === 'polygon' && st.pts.length >= 3) {
        const geometry: GeoJSON.Geometry = { type: 'Polygon', coordinates: [[...st.pts, st.pts[0]!]] }
        updateDrawn({ geometry, kind: 'polygon' })
        setDraft([featureFor(geometry)])
      } else if (st.tool === 'corridor' && st.pts.length >= 2) {
        const geometry: GeoJSON.Geometry = { type: 'LineString', coordinates: st.pts }
        updateDrawn({ geometry, kind: 'corridor' })
        setDraft([featureFor(geometry)])
      } else return
      // lock: a finished shape never sprouts copies from further clicks — redrawing is explicit
      toolRef.current = { tool: null, center: null, pts: [] }
      setRadiusLabel(null)
      map.getCanvas().style.cursor = ''
      map.doubleClickZoom.enable()
    }

    // ── editing an EXISTING zone: the same shapes, dragged instead of drawn ──
    const editGeometry = (ed: EditShape): GeoJSON.Geometry =>
      ed.kind === 'circle'
        ? circlePolygon(ed.center, ed.radiusM)
        : { type: 'Polygon', coordinates: [[...ed.pts, ed.pts[0]!]] }

    /** What you can grab. A circle is not edited by its 64 ring points — those are an artefact of
     *  how we store it — but by its centre (move) and one grip due east (resize). */
    const handlesOf = (ed: EditShape): [number, number][] =>
      ed.kind === 'circle' ? [ed.center, dueEast(ed.center, ed.radiusM)] : ed.pts

    const renderEdit = () => {
      const ed = editRef.current
      if (ed === null) return
      const geometry = editGeometry(ed)
      const bad = ed.kind === 'polygon' && selfIntersects(ed.pts)
      setShapeInvalid(bad)
      // every drag writes the shape straight through, so Save never depends on a final gesture
      updateDrawn({ geometry, kind: ed.kind })
      setDraft([
        featureFor(geometry, bad),
        ...handlesOf(ed).map((pt, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: pt },
          properties: {
            color: draftColorRef.current,
            // the circle's resize grip is the inverted one: among two handles the odd one out is
            // the one that does the unusual thing
            anchor: ed.kind === 'circle' && i === 1,
            armed: false,
          },
        })),
      ])
    }
    ;(renderEditRef as { current: typeof renderEdit }).current = renderEdit

    const grabAt = (pt: { x: number; y: number }): typeof dragRef.current => {
      const ed = editRef.current
      if (ed === null) return null
      const hs = handlesOf(ed)
      for (const [i, h] of hs.entries()) {
        const p = map.project({ lng: h[0], lat: h[1] })
        if (Math.hypot(p.x - pt.x, p.y - pt.y) > GRAB_PX) continue
        if (ed.kind === 'circle') return i === 0 ? { kind: 'center' } : { kind: 'radius' }
        return { kind: 'vertex', i }
      }
      return null
    }

    map.on('mousedown', (e) => {
      if (editRef.current === null) return
      const grab = grabAt(e.point)
      if (grab === null) return
      e.preventDefault() // the map must not pan out from under the handle
      dragRef.current = grab
      map.dragPan.disable()
    })

    map.on('mousemove', (e) => {
      const ed = editRef.current
      if (ed === null) return
      const drag = dragRef.current
      if (drag === null) {
        // hovering: name the gesture before it is made
        const over = grabAt(e.point)
        map.getCanvas().style.cursor =
          over === null ? '' : over.kind === 'radius' ? 'ew-resize' : over.kind === 'center' ? 'move' : 'grab'
        return
      }
      const at: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      if (ed.kind === 'circle') {
        if (drag.kind === 'center') ed.center = at
        else ed.radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, haversineM(ed.center, at)))
        setRadiusLabel({ x: e.point.x, y: e.point.y, text: fmtRadius(ed.radiusM) })
      } else if (drag.kind === 'vertex') {
        ed.pts[drag.i] = at
      }
      renderEdit()
    })

    const endDrag = () => {
      if (dragRef.current === null) return
      dragRef.current = null
      map.dragPan.enable()
      setRadiusLabel(null)
    }
    map.on('mouseup', endDrag)
    // a pointer released outside the canvas still ends the drag — otherwise the handle sticks to
    // the cursor and the next click on the map moves it somewhere the operator never aimed
    window.addEventListener('mouseup', endDrag)


    map.on('click', (e) => {
      const st = toolRef.current
      if (st.tool === null) return
      const at: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      if (st.tool === 'circle') {
        if (st.center === null) {
          st.center = at // first click: the centre; the circle grows under the cursor
          setCircleMeta({ center: at, radiusM: 0 })
          return
        }
        const radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, haversineM(st.center, at)))
        const geometry = circlePolygon(st.center, radiusM)
        setCircleMeta({ center: st.center, radiusM: Math.round(radiusM) })
        updateDrawn({ geometry, kind: 'circle' })
        setDraft([featureFor(geometry)])
        toolRef.current = { tool: null, center: null, pts: [] }
        setRadiusLabel(null)
        map.getCanvas().style.cursor = ''
        map.doubleClickZoom.enable()
        return
      }
      // polygon: clicking back on the FIRST vertex closes the ring
      if (st.tool === 'polygon' && st.pts.length >= 3) {
        const first = map.project({ lng: st.pts[0]![0], lat: st.pts[0]![1] })
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_PX) {
          finishSketch()
          return
        }
      }
      st.pts.push(at)
      preview(null)
    })
    map.on('dblclick', (e) => {
      const st = toolRef.current
      if (st.tool === null) return
      e.preventDefault()
      // the double-click already fired two 'click's — drop the duplicate trailing vertices
      // (screen distance, not degrees: CLOSE_PX means "the same spot" at any zoom)
      while (st.pts.length >= 2) {
        const last = map.project({ lng: st.pts[st.pts.length - 1]![0], lat: st.pts[st.pts.length - 1]![1] })
        const prev = map.project({ lng: st.pts[st.pts.length - 2]![0], lat: st.pts[st.pts.length - 2]![1] })
        if (Math.hypot(last.x - prev.x, last.y - prev.y) > CLOSE_PX) break
        st.pts.pop()
      }
      finishSketch()
    })
    map.on('mousemove', (e) => {
      const st = toolRef.current
      if (st.tool === null) return
      const at: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      if (st.tool === 'circle') {
        if (st.center === null) return
        const radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, haversineM(st.center, at)))
        preview(at)
        setRadiusLabel({ x: e.point.x, y: e.point.y, text: fmtRadius(radiusM) })
        return
      }
      preview(at)
      // over the closing vertex, and close enough that a click WOULD land: say so. Same CLOSE_PX
      // the click handler uses, so the cursor never promises a hit that then misses.
      if (st.tool === 'polygon' && st.pts.length >= 3) {
        const first = map.project({ lng: st.pts[0]![0], lat: st.pts[0]![1] })
        const over = Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_PX
        map.getCanvas().style.cursor = over ? 'pointer' : 'crosshair'
      }
    })

    map.on('style.load', () => {
      if (disposed) return
      if (!map.getSource('gf-draft')) {
        // the drawing tool's live preview (survives theme swaps by re-adding here)
        map.addSource('gf-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'gf-draft-fill', type: 'fill', source: 'gf-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 } })
        // a ring that crosses itself turns red HERE rather than at save time, where PostGIS's
        // rejection arrives as the same message an oversized zone gets
        map.addLayer({ id: 'gf-draft-line', type: 'line', source: 'gf-draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': ['case', ['boolean', ['get', 'invalid'], false], '#ef4444', ['get', 'color']] as never, 'line-width': 2, 'line-dasharray': [2, 1.5] } })
        // The closing vertex is INVERTED (white fill, coloured ring), not merely bigger: among a
        // dozen dots a size difference is easy to miss, filled-vs-hollow is not. It grows again
        // once the ring can actually be closed, so the dot answers "can I finish here yet"
        // without a legend.
        const isAnchor = ['boolean', ['get', 'anchor'], false]
        const isArmed = ['boolean', ['get', 'armed'], false]
        map.addLayer({
          id: 'gf-draft-pts',
          type: 'circle',
          source: 'gf-draft',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': ['case', isArmed, 8, isAnchor, 6.5, 4.5] as never,
            'circle-color': ['case', isAnchor, '#ffffff', ['get', 'color']] as never,
            'circle-stroke-color': ['case', isAnchor, ['get', 'color'], '#ffffff'] as never,
            'circle-stroke-width': ['case', isAnchor, 3, 1.5] as never,
          },
        })
      }
      if (!map.getSource('geofences')) {
        map.addSource('geofences', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'gf-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 } })
        map.addLayer({ id: 'gf-line', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } })
        // selection highlight: thicker line for the selected zone only (filter set below)
        map.addLayer({ id: 'gf-selected', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 4 }, filter: ['==', ['get', 'id'], ''] })
      }
      setStyleEpoch((e) => e + 1)
    })
    return () => {
      disposed = true
      window.removeEventListener('mouseup', endDrag)
      stopWatch()
      unsubscribe()
      map.remove()
      mapRef.current = null
      setStyleEpoch(0)
    }
  }, [])

  // re-apply the draft preview after a theme swap rebuilt the (empty) draft source
  useEffect(() => {
    if (styleEpoch === 0) return
    const d = drawnRef.current
    if (d !== null) setDraftRef.current([{ type: 'Feature', geometry: d.geometry, properties: { color: draftColorRef.current } }])
  }, [styleEpoch])

  // render existing geofences on the map (re-applied after every theme swap)
  useEffect(() => {
    const map = mapRef.current
    if (map === null || styleEpoch === 0) return
    // the edited zone is hidden here: the draft layer is already drawing it, and leaving the saved
    // outline underneath makes a dragged vertex look like it snapped back
    const all = geofences.data ?? []
    map.getSource<GeoJSONSource>('geofences')?.setData(
      geofenceFeatures(editingId === null ? all : all.filter((g) => g.id !== editingId)),
    )
  }, [geofences.data, styleEpoch, editingId])

  // selection → highlight layer filter + fit the map to the zone (re-applied per style swap)
  useEffect(() => {
    const map = mapRef.current
    if (map === null || styleEpoch === 0 || !map.getLayer('gf-selected')) return
    map.setFilter('gf-selected', ['==', ['get', 'id'], selectedId ?? ''])
  }, [selectedId, styleEpoch])
  useEffect(() => {
    const map = mapRef.current
    if (map === null || selected === null) return
    const b = geofenceBounds(selected.geometry)
    if (b !== null) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 15, duration: 500 })
  }, [selected])

  /** arm the drawing tool for a kind (or disarm with null) — always a clean, single-shape state */
  const armTool = (kind: DraftKind | null) => {
    const map = mapRef.current
    toolRef.current = { tool: kind, center: null, pts: [] }
    editRef.current = null // drawing REPLACES a shape; the two modes never overlap
    dragRef.current = null
    setReshaping(false)
    setShapeInvalid(false)
    setCircleMeta(null)
    setRadiusLabel(null)
    setDraftRef.current([])
    updateDrawn(null)
    if (map !== null) {
      map.getCanvas().style.cursor = kind === null ? '' : 'crosshair'
      // a finishing double-click must not zoom the map out from under the sketch
      if (kind === null) map.doubleClickZoom.enable()
      else map.doubleClickZoom.disable()
    }
  }

  /** enter draft mode with the given kind (also the panel's type switch and "draw again") */
  const startDraft = (kind: DraftKind) => {
    armTool(kind)
    setDraftKind(kind)
    setSelectedId(null)
    setError(null)
  }
  const cancelDraft = () => {
    armTool(null) // also clears editRef + any in-flight drag
    setDraftKind(null)
    setName('')
    setEditingId(null)
    setError(null)
  }

  /**
   * Open an existing zone for editing — with its own shape under the cursor, not a blank canvas.
   *
   * It used to arm the drawing tool on an EMPTY sketch, so "edit" meant "redraw from scratch and
   * hope you land near the old outline" (founder report). Now the zone's vertices come back as
   * draggable handles: a polygon by its corners, a circle by its centre and one resize grip.
   *
   * A corridor still redraws, and that is a storage limit rather than a decision: `geofences.geom`
   * holds only the buffered polygon, so its centre-line was never persisted and there is nothing to
   * hand back (ADR-040). Offering handles there would let an operator drag the buffer's OUTLINE and
   * save it as the shape — a silent change of meaning, which is worse than asking them to redraw.
   */
  const startEdit = (g: GeofenceView) => {
    setDraftKind(g.kind)
    setEditingId(g.id)
    setName(g.name)
    setColor(g.color ?? COLORS[0]!)
    draftColorRef.current = g.color ?? COLORS[0]!
    setBufferM(100)
    setSelectedId(null)
    setError(null)

    const pts = ringOf(g.geometry)
    if (g.kind === 'corridor' || pts === null) {
      armTool(g.kind) // redraw path — armTool clears any edit state
      return
    }
    armTool(null) // clears the drawing tool (and editRef) before we set our own
    editRef.current = g.kind === 'circle' ? { kind: 'circle', ...circleFromRing(pts) } : { kind: 'polygon', pts }
    setReshaping(true)
    renderEditRef.current()
  }

  const save = () => {
    // creating requires a drawn shape; EDITING does not — name/colour alone is a valid save
    if ((editingId === null && drawn === null) || name.trim() === '' || saving || shapeInvalid) return
    setError(null)
    setSaving(true)
    // a corridor sends its route line + buffer half-width; polygon/circle send the drawn polygon
    const req = editingId !== null
      ? updateGeofence(editingId, {
          name: name.trim(),
          color,
          ...(drawn !== null
            ? drawn.kind === 'corridor'
              ? { line: drawn.geometry, bufferM }
              : { geometry: drawn.geometry }
            : {}),
        })
      : drawn!.kind === 'corridor'
        ? createGeofence({ name: name.trim(), kind: 'corridor', color, line: drawn!.geometry, bufferM })
        : createGeofence({ name: name.trim(), kind: drawn!.kind, color, geometry: drawn!.geometry })
    req
      .then(() => {
        setName(''); armTool(null); setDraftKind(null); setEditingId(null)
        void qc.invalidateQueries({ queryKey: ['geofences'] })
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 400 ? t('geofences.invalid') : t('geofences.error')))
      .finally(() => setSaving(false))
  }

  const list = geofences.data ?? []
  const filtered = list.filter((g) => q.trim() === '' || g.name.toLowerCase().includes(q.trim().toLowerCase()))
  const drafting = draftKind !== null

  return (
    <div className="flex h-full flex-col gap-3 p-4 md:p-6">
      <PageHeader title={t('geofences.title')} description={t('geofences.desc')} className="mb-0">
        {canWrite && (drafting ? (
          <>
            {/* draft header (reference): Cancel + Save; the form lives in the aside DraftPanel */}
            <AdminButton variant="secondary" data-testid="gf-clear" onClick={cancelDraft}>
              <X className="h-4 w-4" aria-hidden />
              {t('admin.cancel')}
            </AdminButton>
            <AdminButton disabled={(editingId === null && drawn === null) || name.trim() === '' || saving || shapeInvalid} data-testid="gf-save" onClick={save}>
              <Check className="h-4 w-4" aria-hidden />
              {t('geofences.save')}
            </AdminButton>
          </>
        ) : (
          <div className="flex gap-1">
            {/* mode buttons double as draft entry points (the tool needs the shape kind up
                front, so a single "New geofence" button cannot start the drawing tools) */}
            <AdminButton variant="secondary" size="sm" data-testid="gf-mode-polygon" onClick={() => startDraft('polygon')}>{t('geofences.polygon')}</AdminButton>
            <AdminButton variant="secondary" size="sm" data-testid="gf-mode-circle" onClick={() => startDraft('circle')}>{t('geofences.circle')}</AdminButton>
            <AdminButton variant="secondary" size="sm" data-testid="gf-mode-corridor" onClick={() => startDraft('corridor')}>{t('geofences.corridor')}</AdminButton>
          </div>
        ))}
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* aside (design split view): DraftPanel while drafting, else search + list */}
        <aside className="admin-card flex min-h-0 flex-col overflow-hidden">
          {drafting ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="gf-draft-panel">
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>
                  {editingId !== null ? t('geofences.editTitle') : t('geofences.new')}
                </div>
                <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                  {reshaping ? t('geofences.editHintDrag') : editingId !== null ? t('geofences.editHint') : t('geofences.draftHint')}
                </div>
              </div>
              <div>
                <AdminLabel>{t('geofences.name')}</AdminLabel>
                <AdminInput value={name} onChange={(e) => setName(e.target.value)} data-testid="gf-name" />
              </div>
              <div>
                <AdminLabel>{t('geofences.type')}</AdminLabel>
                {editingId !== null ? (
                  <Badge tone="neutral" data-testid="gf-edit-kind">{t(`geofences.${draftKind}`)}</Badge>
                ) : (
                <AdminRadio
                  name="gf-type"
                  value={draftKind}
                  onChange={(v) => startDraft(v as DraftKind)}
                  options={[
                    { value: 'polygon', label: t('geofences.polygon'), hint: t('geofences.typeHint.polygon') },
                    { value: 'circle', label: t('geofences.circle'), hint: t('geofences.typeHint.circle') },
                    { value: 'corridor', label: t('geofences.corridor'), hint: t('geofences.typeHint.corridor') },
                  ]}
                />
                )}
              </div>
              <div>
                <AdminLabel>{t('geofences.color')}</AdminLabel>
                {/* curated swatch row (reference) — arbitrary colors still arrive via branding */}
                <div className="flex gap-2" data-testid="gf-color">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setColor(c)
                        draftColorRef.current = c
                        // recolor the live preview immediately
                        if (drawnRef.current !== null) setDraftRef.current([{ type: 'Feature', geometry: drawnRef.current.geometry, properties: { color: c } }])
                      }}
                      aria-label={c}
                      aria-pressed={color === c}
                      className="h-7 w-7 rounded-full transition-transform"
                      style={{ background: c, outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2, transform: color === c ? 'scale(1.08)' : 'scale(1)' }}
                    />
                  ))}
                </div>
              </div>
              {draftKind === 'corridor' && (
                <div>
                  <AdminLabel>{t('geofences.buffer')}</AdminLabel>
                  <AdminInput type="number" min={10} max={5000} step={10} value={bufferM} onChange={(e) => setBufferM(Math.max(10, Math.min(5000, Number(e.target.value) || 10)))} data-testid="gf-buffer" className="w-24" />
                </div>
              )}
              {draftKind === 'circle' && circleMeta !== null && circleMeta.radiusM > 0 && (
                <div>
                  <AdminLabel>{t('geofences.radius')}</AdminLabel>
                  <div className="flex items-center gap-2">
                    <AdminInput
                      type="number" min={MIN_RADIUS_M} max={MAX_RADIUS_M} step={10}
                      value={circleMeta.radiusM}
                      data-testid="gf-radius"
                      className="w-28"
                      onChange={(e) => {
                        // the number IS the shape: typing 500 re-generates the circle live
                        const r = Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, Number(e.target.value) || MIN_RADIUS_M))
                        setCircleMeta({ center: circleMeta.center, radiusM: r })
                        const geometry = circlePolygon(circleMeta.center, r)
                        updateDrawn({ geometry, kind: 'circle' })
                        setDraftRef.current([{ type: 'Feature', geometry, properties: { color: draftColorRef.current } }])
                      }}
                    />
                    <span className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>m</span>
                  </div>
                </div>
              )}
              {drawn !== null && (
                <AdminButton variant="ghost" size="sm" data-testid="gf-redraw" onClick={() => startDraft(draftKind)}>
                  {t('geofences.redraw')}
                </AdminButton>
              )}
              <div className="rounded-md p-2 text-xs" style={{ background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink-soft)' }}>
                {reshaping ? t('geofences.hintEdit') : t(`geofences.hint.${draftKind}`)}
              </div>
              {error !== null && <span role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</span>}
            </div>
          ) : (
            <>
              <div className="admin-hairline-b p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-60" aria-hidden />
                  <AdminInput placeholder={t('geofences.search')} value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" data-testid="gf-search" aria-label={t('geofences.search')} />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {deleteError && (
                  <p role="alert" className="mb-2 px-1 text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="gf-action-error">
                    {t('geofences.deleteError')}
                  </p>
                )}
                {geofences.isError ? (
                  <p role="alert" className="py-8 text-center text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="gf-error">{t('admin.loadError')}</p>
                ) : geofences.isLoading ? (
                  <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="gf-loading">{t('admin.loading')}</p>
                ) : list.length === 0 ? (
                  <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="gf-empty">{t('geofences.empty')}</p>
                ) : filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="gf-no-results">{t('admin.nothingFound')}</p>
                ) : (
                  <ul className="space-y-1" data-testid="gf-list">
                    {filtered.map((g: GeofenceView) => {
                      const KindIcon = KIND_ICON[g.kind] ?? Hexagon
                      const isSel = g.id === selectedId
                      return (
                        <li
                          key={g.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--admin-brand)]"
                          style={{
                            borderColor: isSel ? 'var(--admin-brand)' : 'var(--admin-hairline)',
                            background: isSel ? 'var(--admin-brand-soft)' : 'transparent',
                            color: isSel ? 'var(--admin-brand)' : 'var(--admin-ink)',
                          }}
                          data-testid={`gf-${g.id}`}
                          // row click selects (highlight + map fit); keyboard parity via Enter/Space
                          onClick={() => setSelectedId((cur) => (cur === g.id ? null : g.id))}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedId((cur) => (cur === g.id ? null : g.id))
                            }
                          }}
                          aria-selected={isSel}
                        >
                          {/* tinted icon chip by kind (Lovable idiom): hex color + '22' = ~13% alpha */}
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: `${g.color}22`, color: g.color }} aria-hidden>
                            <KindIcon className="h-3.5 w-3.5" />
                          </span>
                          <span className="truncate font-medium">{g.name}</span>
                          <Badge tone="neutral" className="ml-auto">{t(`geofences.${g.kind}`)}</Badge>
                          {canWrite && (
                            <button
                              type="button"
                              aria-label={t('geofences.edit')}
                              data-testid={`gf-edit-${g.id}`}
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--admin-brand-soft)]"
                              style={{ color: 'var(--admin-ink-soft)' }}
                              onClick={(e) => {
                                e.stopPropagation() // edit must not toggle row selection
                                startEdit(g)
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          )}
                          {canWrite && (
                            <button
                              type="button"
                              aria-label={t('geofences.delete')}
                              data-testid={`gf-del-${g.id}`}
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                              style={{ color: 'var(--admin-danger)' }}
                              onClick={(e) => {
                                e.stopPropagation() // delete must not toggle row selection
                                setDeleteForId(g.id)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </aside>

        {/* map panel */}
        <div className="admin-card relative min-h-[320px] overflow-hidden lg:min-h-0">
          <div ref={containerRef} className="h-full w-full" data-testid="geofence-map" data-drawing={drafting ? 'true' : undefined} />
          {radiusLabel !== null && (
            <span
              className="pointer-events-none absolute z-10 rounded border px-1.5 py-0.5 font-mono text-[11px] shadow"
              style={{ left: radiusLabel.x + 14, top: radiusLabel.y + 14, background: 'var(--admin-surface)', borderColor: 'var(--admin-hairline)', color: 'var(--admin-ink)' }}
              data-testid="gf-radius-label"
            >
              {radiusLabel.text}
            </span>
          )}
          <MapErrorOverlay show={mapError} testId="geofence-map-error" />
          {/* Contextual draw hint while drafting. Two states so "how do I finish?" is never a
              mystery: (1) drawing → the per-shape gesture to CLOSE the shape; (2) once the tool
              fires 'finish' (drawn !== null) → an explicit "done, now name it and Save" so the
              user gets unambiguous closure and the next step. */}
          {drafting && (
            <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-[min(20rem,calc(100%-2rem))]" data-testid="gf-draw-hint" role="status" aria-live="polite">
              {drawn === null ? (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--admin-surface)', boxShadow: 'var(--admin-shadow-lg)', border: '1px solid var(--admin-brand)' }}>
                  <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--admin-brand)' }} aria-hidden />
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--admin-brand)' }}>{t('geofences.drawing')}</div>
                    <div style={{ color: 'var(--admin-ink-soft)' }}>{reshaping ? t('geofences.hintEdit') : t(`geofences.hint.${draftKind}`)}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--admin-success-soft)', boxShadow: 'var(--admin-shadow-lg)', border: '1px solid var(--admin-success)' }} data-testid="gf-draw-done">
                  <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--admin-success)' }} aria-hidden />
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--admin-success)' }}>{t('geofences.drawnTitle')}</div>
                    <div style={{ color: 'var(--admin-ink-soft)' }}>{shapeInvalid ? t('geofences.selfCross') : name.trim() === '' ? t('geofences.drawnNeedName') : editingId !== null ? t('geofences.drawnReadyEdit') : t('geofences.drawnReady')}</div>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* floating detail card for the selected zone (reference bottom-left overlay) */}
          {!drafting && selected !== null && (
            <div className="absolute bottom-4 left-4 right-4 z-10 md:right-auto md:w-80" data-testid="gf-detail">
              <div className="admin-card p-4" style={{ boxShadow: 'var(--admin-shadow-lg)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" style={{ color: 'var(--admin-ink)' }}>{selected.name}</div>
                    <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
                      {t('geofences.createdAt', { date: dt(selected.createdAt) })} · {t(`geofences.${selected.kind}`)}
                    </div>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => setDeleteForId(selected.id)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--admin-danger-soft)]"
                      style={{ color: 'var(--admin-danger)' }}
                      data-testid="gf-detail-delete"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                      {t('geofences.delete')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteFor !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteForId(null)
        }}
        tone="danger"
        title={t('geofences.delete')}
        description={deleteFor !== null ? t('geofences.deleteSure', { name: deleteFor.name }) : undefined}
        confirmLabel={t('geofences.delete')}
        onConfirm={() => {
          const g = deleteFor
          if (g === null) return
          if (selectedId === g.id) setSelectedId(null) // never leave the detail card on a ghost
          setDeleteError(false)
          void deleteGeofence(g.id)
            .then(() => qc.invalidateQueries({ queryKey: ['geofences'] }))
            .catch(() => setDeleteError(true)) // don't let a failed delete look like it succeeded
        }}
      />
    </div>
  )
}
