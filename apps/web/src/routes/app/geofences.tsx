import type { GeofenceView } from '@orbetra/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Circle as CircleIcon, Hexagon, Route as RouteIcon, Trash2 } from 'lucide-react'
import type { GeoJSONSource, Map as MbMap } from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TerraDraw, TerraDrawCircleMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode, type GeoJSONStoreFeatures } from 'terra-draw'
import { TerraDrawMapboxGLAdapter } from 'terra-draw-mapbox-gl-adapter'

import { AdminButton, AdminInput, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { MapErrorOverlay } from '@/components/MapErrorOverlay'
import { ApiError } from '@/lib/http'
import { createGeofence, deleteGeofence, geofenceFeatures, listGeofences } from '@/lib/geofences'
import { createThemedMap, mapboxgl, watchMapLoad } from '@/lib/map'

const VILNIUS: [number, number] = [25.2797, 54.6872]

type Drawn = { geometry: GeoJSON.Geometry; kind: 'polygon' | 'circle' | 'corridor' } | null
type DrawMode = 'polygon' | 'circle' | 'linestring' | 'select'

const fieldCls = 'flex flex-col gap-1 text-xs'
const fieldStyle = { color: 'var(--admin-ink-soft)' } as const

/** kind → list-row icon (Lovable app.geofences idiom: tinted chip per shape kind). */
const KIND_ICON = { polygon: Hexagon, circle: CircleIcon, corridor: RouteIcon } as const

/** Geofences (E05-1): draw polygon/circle with terra-draw, save, list, delete.
 *  Corridor (V2): draw a route LineString + a buffer half-width; the server buffers it to a polygon.
 *  Round 2 (ADR-028): list rows polished to the Lovable idiom (icon chip by kind, name, kind
 *  Badge) and delete goes through a danger ConfirmDialog. */
export function GeofencesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: listGeofences })
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MbMap | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  // bumps on EVERY style.load (initial + theme swaps, ADR-030) so the geofence
  // features get re-applied to the freshly rebuilt (empty) source
  const [styleEpoch, setStyleEpoch] = useState(0)
  const [mapError, setMapError] = useState(false) // constructor threw / style never loaded
  const [drawn, setDrawn] = useState<Drawn>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#4DA3FF')
  const [bufferM, setBufferM] = useState(100) // corridor half-width in metres (10 … 5000)
  const [error, setError] = useState<string | null>(null)
  // delete target resolves against the LIVE list (devices precedent) — a refetch never
  // leaves the confirm pointed at a stale snapshot
  const [deleteForId, setDeleteForId] = useState<string | null>(null)
  const deleteFor = (geofences.data ?? []).find((g) => g.id === deleteForId) ?? null

  // tracked so the mode buttons can expose an active/pressed state (aria-pressed + variant);
  // the ref mirrors let the map-lifecycle closures read the CURRENT values on a theme swap
  const [activeMode, setActiveMode] = useState<DrawMode>('select')
  const activeModeRef = useRef<DrawMode>('select')
  const drawnRef = useRef<Drawn>(null)
  const updateDrawn = (d: Drawn) => { drawnRef.current = d; setDrawn(d) }
  // features carried across a theme swap (detached in onBeforeStyleSwap, re-added in style.load)
  const pendingFeaturesRef = useRef<GeoJSONStoreFeatures[]>([])

  // map + terra-draw lifecycle
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { map, unsubscribe } = createThemedMap(container, {
      center: VILNIUS,
      zoom: 10,
      // MED-3: a theme setStyle drops terra-draw's td-* sources while the instance is
      // still live — a Clear/mode click in that window would throw inside the adapter.
      // Detach BEFORE the swap (its layers still exist here); style.load re-attaches.
      onBeforeStyleSwap: () => {
        const draw = drawRef.current
        if (draw === null) return
        try {
          // LOW-6: carry only the FINISHED shape across the swap. A mid-draw sketch
          // would come back as a dead static feature the user can never finish — drop
          // it (the finished one is identified by the geometry saved on 'finish').
          const finished = drawnRef.current
          pendingFeaturesRef.current = finished === null
            ? []
            : draw.getSnapshot().filter((f) => JSON.stringify(f.geometry) === JSON.stringify(finished.geometry))
          draw.stop()
        } catch (err) {
          pendingFeaturesRef.current = []
          console.error('terra-draw detach before theme swap failed', err)
        }
      },
    })
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
    // idempotent: style.load re-fires after every theme setStyle, which drops all
    // runtime sources/layers INCLUDING terra-draw's — everything is re-attached here
    map.on('style.load', () => {
      if (disposed) return
      if (!map.getSource('geofences')) {
        map.addSource('geofences', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'gf-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 } })
        map.addLayer({ id: 'gf-line', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } })
      }
      if (drawRef.current === null) {
        const draw = new TerraDraw({
          adapter: new TerraDrawMapboxGLAdapter({ map, coordinatePrecision: 9 }),
          modes: [new TerraDrawPolygonMode(), new TerraDrawCircleMode(), new TerraDrawLineStringMode(), new TerraDrawSelectMode()],
        })
        draw.start()
        draw.on('finish', (id) => {
          const feat = draw.getSnapshot().find((f) => f.id === id)
          if (!feat) return
          if (feat.geometry.type === 'Polygon') {
            const mode = feat.properties['mode']
            updateDrawn({ geometry: feat.geometry as GeoJSON.Geometry, kind: mode === 'circle' ? 'circle' : 'polygon' })
          } else if (feat.geometry.type === 'LineString') {
            updateDrawn({ geometry: feat.geometry as GeoJSON.Geometry, kind: 'corridor' })
          }
        })
        drawRef.current = draw
      } else {
        // theme swap (instance was stopped in onBeforeStyleSwap): restart on the new
        // style, restoring the finished shape and the active mode
        const draw = drawRef.current
        try {
          draw.start()
          if (pendingFeaturesRef.current.length > 0) draw.addFeatures(pendingFeaturesRef.current)
          pendingFeaturesRef.current = []
          draw.setMode(activeModeRef.current)
        } catch (err) {
          console.error('terra-draw restart after theme swap failed', err)
        }
      }
      setStyleEpoch((e) => e + 1)
    })
    return () => {
      disposed = true
      stopWatch()
      try { drawRef.current?.stop() } catch { /* map already gone */ }
      drawRef.current = null
      unsubscribe()
      map.remove()
      mapRef.current = null
      setStyleEpoch(0)
    }
  }, [])

  // render existing geofences on the map (re-applied after every theme swap)
  useEffect(() => {
    const map = mapRef.current
    if (map === null || styleEpoch === 0) return
    map.getSource<GeoJSONSource>('geofences')?.setData(geofenceFeatures(geofences.data ?? []))
  }, [geofences.data, styleEpoch])

  // try/catch: a click can land in the brief window where terra-draw is detached for a
  // theme swap (stopped instance throws) — dropping the input beats crashing the page
  const setMode = (mode: DrawMode) => {
    try {
      drawRef.current?.setMode(mode)
      if (mode !== 'select') { drawRef.current?.clear(); updateDrawn(null) }
    } catch (err) {
      console.error('terra-draw mode change ignored (style swap in progress)', err)
      return
    }
    setActiveMode(mode)
    activeModeRef.current = mode
  }
  const clearDraw = () => {
    try { drawRef.current?.clear() } catch (err) { console.error('terra-draw clear ignored (style swap in progress)', err); return }
    updateDrawn(null)
    setActiveMode('select')
    activeModeRef.current = 'select'
  }

  const save = () => {
    if (drawn === null || name.trim() === '') return
    setError(null)
    // a corridor sends its route line + buffer half-width; polygon/circle send the drawn polygon
    const created = drawn.kind === 'corridor'
      ? createGeofence({ name: name.trim(), kind: 'corridor', color, line: drawn.geometry, bufferM })
      : createGeofence({ name: name.trim(), kind: drawn.kind, color, geometry: drawn.geometry })
    created
      .then(() => {
        setName(''); clearDraw()
        void qc.invalidateQueries({ queryKey: ['geofences'] })
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 400 ? t('geofences.invalid') : t('geofences.error')))
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4 md:p-6">
      <PageHeader title={t('geofences.title')} description={t('geofences.desc')} className="mb-0">
        <div className="flex gap-1">
          <AdminButton variant={activeMode === 'polygon' ? 'primary' : 'secondary'} size="sm" aria-pressed={activeMode === 'polygon'} data-testid="gf-mode-polygon" onClick={() => setMode('polygon')}>{t('geofences.polygon')}</AdminButton>
          <AdminButton variant={activeMode === 'circle' ? 'primary' : 'secondary'} size="sm" aria-pressed={activeMode === 'circle'} data-testid="gf-mode-circle" onClick={() => setMode('circle')}>{t('geofences.circle')}</AdminButton>
          <AdminButton variant={activeMode === 'linestring' ? 'primary' : 'secondary'} size="sm" aria-pressed={activeMode === 'linestring'} data-testid="gf-mode-corridor" onClick={() => setMode('linestring')}>{t('geofences.corridor')}</AdminButton>
          <AdminButton variant="ghost" size="sm" data-testid="gf-clear" onClick={clearDraw}>{t('geofences.clear')}</AdminButton>
        </div>
        {drawn?.kind === 'corridor' && (
          <label className={fieldCls} style={fieldStyle}>{t('geofences.buffer')}
            <AdminInput type="number" min={10} max={5000} step={10} value={bufferM} onChange={(e) => setBufferM(Math.max(10, Math.min(5000, Number(e.target.value) || 10)))} data-testid="gf-buffer" className="w-24" />
          </label>
        )}
        <label className={fieldCls} style={fieldStyle}>{t('geofences.name')}
          <AdminInput value={name} onChange={(e) => setName(e.target.value)} data-testid="gf-name" className="w-40" />
        </label>
        <label className={fieldCls} style={fieldStyle}>{t('geofences.color')}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} data-testid="gf-color" className="h-9 w-12 rounded-md border" style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)' }} />
        </label>
        <AdminButton disabled={drawn === null || name.trim() === ''} data-testid="gf-save" onClick={save}>{t('geofences.save')}</AdminButton>
        {error !== null && <span role="alert" className="w-full text-sm" style={{ color: 'var(--admin-danger)' }}>{error}</span>}
      </PageHeader>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* list aside (design split view: list left, map right) */}
        <aside className="admin-card flex min-h-0 flex-col overflow-hidden">
          <div className="admin-hairline-b px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--admin-ink-soft)' }}>
            {t('geofences.title')}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {(geofences.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="gf-empty">{t('geofences.empty')}</p>
            ) : (
              <ul className="space-y-1" data-testid="gf-list">
                {(geofences.data ?? []).map((g: GeofenceView) => {
                  const KindIcon = KIND_ICON[g.kind] ?? Hexagon
                  return (
                    <li key={g.id} className="flex items-center gap-2 rounded-md border p-2 text-sm" style={{ borderColor: 'var(--admin-hairline)', color: 'var(--admin-ink)' }} data-testid={`gf-${g.id}`}>
                      {/* tinted icon chip by kind (Lovable idiom): hex color + '22' = ~13% alpha */}
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md" style={{ background: `${g.color}22`, color: g.color }} aria-hidden>
                        <KindIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate font-medium">{g.name}</span>
                      <Badge tone="neutral" className="ml-auto">{t(`geofences.${g.kind}`)}</Badge>
                      <button
                        type="button"
                        aria-label={t('geofences.delete')}
                        data-testid={`gf-del-${g.id}`}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--admin-danger-soft)]"
                        style={{ color: 'var(--admin-danger)' }}
                        onClick={() => setDeleteForId(g.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* map panel */}
        <div className="admin-card relative min-h-[320px] overflow-hidden lg:min-h-0">
          <div ref={containerRef} className="h-full w-full" data-testid="geofence-map" />
          <MapErrorOverlay show={mapError} testId="geofence-map-error" />
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
          void deleteGeofence(g.id).then(() => qc.invalidateQueries({ queryKey: ['geofences'] })).catch(() => undefined)
        }}
      />
    </div>
  )
}
