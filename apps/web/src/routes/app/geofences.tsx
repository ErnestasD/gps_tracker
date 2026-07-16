import type { GeofenceView } from '@orbetra/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TerraDraw, TerraDrawCircleMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

import { AdminButton, AdminInput, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ApiError } from '@/lib/http'
import { createGeofence, deleteGeofence, geofenceFeatures, listGeofences } from '@/lib/geofences'

const STYLE_URL: string = (import.meta.env.VITE_TILES_STYLE_URL as string | undefined) ?? 'https://tiles.openfreemap.org/styles/liberty'
const VILNIUS: [number, number] = [25.2797, 54.6872]

type Drawn = { geometry: GeoJSON.Geometry; kind: 'polygon' | 'circle' | 'corridor' } | null

const fieldCls = 'flex flex-col gap-1 text-xs'
const fieldStyle = { color: 'var(--admin-ink-soft)' } as const

/** Geofences (E05-1): draw polygon/circle with terra-draw, save, list, delete.
 *  Corridor (V2): draw a route LineString + a buffer half-width; the server buffers it to a polygon. */
export function GeofencesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: listGeofences })
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState(false) // map/tiles failed to load (e.g. a network filter blocking the tile CDN)
  const [drawn, setDrawn] = useState<Drawn>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#4DA3FF')
  const [bufferM, setBufferM] = useState(100) // corridor half-width in metres (10 … 5000)
  const [error, setError] = useState<string | null>(null)

  // map + terra-draw lifecycle
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const map = new MlMap({ container, style: STYLE_URL, center: VILNIUS, zoom: 10, attributionControl: { compact: false, customAttribution: '© OpenStreetMap contributors' } })
    mapRef.current = map
    ;(container as HTMLDivElement & { __map?: MlMap }).__map = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('error', (e) => console.error('maplibre', e.error))
    // if the base map never loads (blocked tile CDN / offline / WebGL failure), the draw tools can't
    // attach — surface it instead of leaving the polygon/circle buttons silently dead.
    const loadTimer = setTimeout(() => { if (!drawRef.current) setMapError(true) }, 8000)
    map.on('load', () => {
      clearTimeout(loadTimer)
      map.addSource('geofences', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'gf-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 } })
      map.addLayer({ id: 'gf-line', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } })
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }),
        modes: [new TerraDrawPolygonMode(), new TerraDrawCircleMode(), new TerraDrawLineStringMode(), new TerraDrawSelectMode()],
      })
      draw.start()
      draw.on('finish', (id) => {
        const feat = draw.getSnapshot().find((f) => f.id === id)
        if (!feat) return
        if (feat.geometry.type === 'Polygon') {
          const mode = feat.properties['mode']
          setDrawn({ geometry: feat.geometry as GeoJSON.Geometry, kind: mode === 'circle' ? 'circle' : 'polygon' })
        } else if (feat.geometry.type === 'LineString') {
          setDrawn({ geometry: feat.geometry as GeoJSON.Geometry, kind: 'corridor' })
        }
      })
      drawRef.current = draw
      setReady(true)
    })
    return () => {
      clearTimeout(loadTimer)
      try { drawRef.current?.stop() } catch { /* map already gone */ }
      drawRef.current = null
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // render existing geofences on the map
  useEffect(() => {
    const map = mapRef.current
    if (map === null || !ready) return
    map.getSource<maplibregl.GeoJSONSource>('geofences')?.setData(geofenceFeatures(geofences.data ?? []))
  }, [geofences.data, ready])

  const setMode = (mode: 'polygon' | 'circle' | 'linestring' | 'select') => {
    drawRef.current?.setMode(mode)
    if (mode !== 'select') { drawRef.current?.clear(); setDrawn(null) }
  }
  const clearDraw = () => { drawRef.current?.clear(); setDrawn(null) }

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
          <AdminButton variant="secondary" size="sm" data-testid="gf-mode-polygon" onClick={() => setMode('polygon')}>{t('geofences.polygon')}</AdminButton>
          <AdminButton variant="secondary" size="sm" data-testid="gf-mode-circle" onClick={() => setMode('circle')}>{t('geofences.circle')}</AdminButton>
          <AdminButton variant="secondary" size="sm" data-testid="gf-mode-corridor" onClick={() => setMode('linestring')}>{t('geofences.corridor')}</AdminButton>
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
                {(geofences.data ?? []).map((g: GeofenceView) => (
                  <li key={g.id} className="flex items-center gap-2 rounded-md border p-2 text-sm" style={{ borderColor: 'var(--admin-hairline)', color: 'var(--admin-ink)' }} data-testid={`gf-${g.id}`}>
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                    <span className="truncate">{g.name}</span>
                    <Badge tone="neutral" className="ml-auto">{t(`geofences.${g.kind}`)}</Badge>
                    <AdminButton variant="ghost" size="sm" style={{ background: 'transparent', color: 'var(--admin-danger)' }} data-testid={`gf-del-${g.id}`} onClick={() => void deleteGeofence(g.id).then(() => qc.invalidateQueries({ queryKey: ['geofences'] })).catch(() => undefined)}>
                      {t('geofences.delete')}
                    </AdminButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* map panel */}
        <div className="admin-card relative min-h-[320px] overflow-hidden lg:min-h-0">
          <div ref={containerRef} className="h-full w-full" data-testid="geofence-map" />
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm" style={{ background: 'color-mix(in srgb, var(--admin-surface) 92%, transparent)', color: 'var(--admin-danger)' }} data-testid="geofence-map-error">
              {t('geofences.mapError')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
