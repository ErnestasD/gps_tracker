import type { GeofenceView } from '@orbetra/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TerraDraw, TerraDrawCircleMode, TerraDrawPolygonMode, TerraDrawSelectMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/lib/http'
import { createGeofence, deleteGeofence, geofenceFeatures, listGeofences } from '@/lib/geofences'

const STYLE_URL: string = (import.meta.env.VITE_TILES_STYLE_URL as string | undefined) ?? 'https://tiles.openfreemap.org/styles/liberty'
const VILNIUS: [number, number] = [25.2797, 54.6872]

type Drawn = { geometry: GeoJSON.Geometry; kind: 'polygon' | 'circle' } | null

/** Geofences (E05-1): draw polygon/circle with terra-draw, save, list, delete. */
export function GeofencesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: listGeofences })
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const [ready, setReady] = useState(false)
  const [drawn, setDrawn] = useState<Drawn>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#4DA3FF')
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
    map.on('load', () => {
      map.addSource('geofences', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'gf-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.15 } })
      map.addLayer({ id: 'gf-line', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } })
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 9 }),
        modes: [new TerraDrawPolygonMode(), new TerraDrawCircleMode(), new TerraDrawSelectMode()],
      })
      draw.start()
      draw.on('finish', (id) => {
        const feat = draw.getSnapshot().find((f) => f.id === id)
        if (feat && feat.geometry.type === 'Polygon') {
          const mode = feat.properties['mode']
          setDrawn({ geometry: feat.geometry as GeoJSON.Geometry, kind: mode === 'circle' ? 'circle' : 'polygon' })
        }
      })
      drawRef.current = draw
      setReady(true)
    })
    return () => {
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

  const setMode = (mode: 'polygon' | 'circle' | 'select') => {
    drawRef.current?.setMode(mode)
    if (mode !== 'select') { drawRef.current?.clear(); setDrawn(null) }
  }
  const clearDraw = () => { drawRef.current?.clear(); setDrawn(null) }

  const save = () => {
    if (drawn === null || name.trim() === '') return
    setError(null)
    createGeofence({ name: name.trim(), kind: drawn.kind, color, geometry: drawn.geometry })
      .then(() => {
        setName(''); clearDraw()
        void qc.invalidateQueries({ queryKey: ['geofences'] })
      })
      .catch((err: unknown) => setError(err instanceof ApiError && err.status === 400 ? t('geofences.invalid') : t('geofences.error')))
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-lg font-semibold">{t('geofences.title')}</h1>
        <div className="flex gap-1">
          <Button variant="secondary" size="sm" data-testid="gf-mode-polygon" onClick={() => setMode('polygon')}>{t('geofences.polygon')}</Button>
          <Button variant="secondary" size="sm" data-testid="gf-mode-circle" onClick={() => setMode('circle')}>{t('geofences.circle')}</Button>
          <Button variant="ghost" size="sm" data-testid="gf-clear" onClick={clearDraw}>{t('geofences.clear')}</Button>
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted">{t('geofences.name')}
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="gf-name" className="w-40" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">{t('geofences.color')}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} data-testid="gf-color" className="h-9 w-12 rounded-card border border-line bg-surface" />
        </label>
        <Button size="sm" disabled={drawn === null || name.trim() === ''} data-testid="gf-save" onClick={save}>{t('geofences.save')}</Button>
        {error !== null && <span role="alert" className="w-full text-sm text-danger">{error}</span>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
        <div ref={containerRef} className="min-h-0 overflow-hidden rounded-card border border-line" data-testid="geofence-map" />
        <Card className="min-h-0 overflow-hidden">
          <CardContent className="h-full overflow-auto p-2">
            {(geofences.data ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted" data-testid="gf-empty">{t('geofences.empty')}</p>
            ) : (
              <ul className="space-y-1" data-testid="gf-list">
                {(geofences.data ?? []).map((g: GeofenceView) => (
                  <li key={g.id} className="flex items-center gap-2 rounded-card border border-line p-2 text-sm" data-testid={`gf-${g.id}`}>
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                    <span className="truncate">{g.name}</span>
                    <Badge variant="outline" className="ml-auto">{t(`geofences.${g.kind}`)}</Badge>
                    <Button variant="ghost" size="sm" data-testid={`gf-del-${g.id}`} onClick={() => void deleteGeofence(g.id).then(() => qc.invalidateQueries({ queryKey: ['geofences'] })).catch(() => undefined)}>
                      {t('geofences.delete')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
