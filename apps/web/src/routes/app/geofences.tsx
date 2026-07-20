import type { GeofenceView } from '@orbetra/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle as CircleIcon, Hexagon, MousePointerClick, Route as RouteIcon, Search, Trash2, X } from 'lucide-react'
import type { GeoJSONSource, Map as MbMap } from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TerraDraw, TerraDrawCircleMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode, type GeoJSONStoreFeatures } from 'terra-draw'
import { TerraDrawMapboxGLAdapter } from 'terra-draw-mapbox-gl-adapter'

import { AdminButton, AdminInput, AdminLabel, AdminRadio, Badge, PageHeader } from '@/components/admin/AdminKit'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import { MapErrorOverlay } from '@/components/MapErrorOverlay'
import { getCurrentUser } from '@/lib/auth'
import { useFmt } from '@/lib/datetime'
import { ApiError } from '@/lib/http'
import { createGeofence, deleteGeofence, geofenceBounds, geofenceFeatures, listGeofences } from '@/lib/geofences'
import { createThemedMap, mapboxgl, watchMapLoad } from '@/lib/map'

const VILNIUS: [number, number] = [25.2797, 54.6872]

type Drawn = { geometry: GeoJSON.Geometry; kind: 'polygon' | 'circle' | 'corridor' } | null
type DrawMode = 'polygon' | 'circle' | 'linestring' | 'select'
type DraftKind = 'polygon' | 'circle' | 'corridor'

/** draft kind → terra-draw mode (a corridor is drawn as its route LineString) */
const TERRA_MODE: Record<DraftKind, DrawMode> = { polygon: 'polygon', circle: 'circle', corridor: 'linestring' }

/** kind → list-row icon (Lovable app.geofences idiom: tinted chip per shape kind). */
const KIND_ICON = { polygon: Hexagon, circle: CircleIcon, corridor: RouteIcon } as const

/** Curated swatch palette (reference COLORS): the draft color picker is a row of round
 * swatches, not a native color input (round-2 control sweep). */
const COLORS = ['#4F46E5', '#059669', '#B45309', '#E11D48', '#0284C7', '#7C3AED']

/** Geofences (E05-1): draw polygon/circle with terra-draw, save, list, delete.
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
  const drawRef = useRef<TerraDraw | null>(null)
  // bumps on EVERY style.load (initial + theme swaps, ADR-030) so the geofence
  // features get re-applied to the freshly rebuilt (empty) source
  const [styleEpoch, setStyleEpoch] = useState(0)
  const [mapError, setMapError] = useState(false) // constructor threw / style never loaded
  const [drawn, setDrawn] = useState<Drawn>(null)
  const [draftKind, setDraftKind] = useState<DraftKind | null>(null) // non-null = draft mode
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
  const deleteFor = (geofences.data ?? []).find((g) => g.id === deleteForId) ?? null
  const selected = (geofences.data ?? []).find((g) => g.id === selectedId) ?? null

  // tracked so the map-lifecycle closures can restore the CURRENT mode on a theme swap
  const [, setActiveMode] = useState<DrawMode>('select')
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
        // selection highlight: thicker line for the selected zone only (filter set below)
        map.addLayer({ id: 'gf-selected', type: 'line', source: 'geofences', paint: { 'line-color': ['get', 'color'], 'line-width': 4 }, filter: ['==', ['get', 'id'], ''] })
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

  // try/catch: a click can land in the brief window where terra-draw is detached for a
  // theme swap (stopped instance throws) — dropping the input beats crashing the page
  const setMode = (mode: DrawMode): boolean => {
    try {
      drawRef.current?.setMode(mode)
      if (mode !== 'select') { drawRef.current?.clear(); updateDrawn(null) }
    } catch (err) {
      console.error('terra-draw mode change ignored (style swap in progress)', err)
      return false
    }
    setActiveMode(mode)
    activeModeRef.current = mode
    return true
  }
  const clearDraw = () => {
    try { drawRef.current?.clear() } catch (err) { console.error('terra-draw clear ignored (style swap in progress)', err); return }
    updateDrawn(null)
    setActiveMode('select')
    activeModeRef.current = 'select'
  }

  /** enter draft mode with the given kind (also used by the panel's type switch) */
  const startDraft = (kind: DraftKind) => {
    if (!setMode(TERRA_MODE[kind])) return
    setDraftKind(kind)
    setSelectedId(null)
    setError(null)
  }
  const cancelDraft = () => {
    clearDraw()
    setDraftKind(null)
    setName('')
    setError(null)
  }

  const save = () => {
    if (drawn === null || name.trim() === '' || saving) return // in-flight guard: no duplicate geofences on double-click
    setError(null)
    setSaving(true)
    // a corridor sends its route line + buffer half-width; polygon/circle send the drawn polygon
    const created = drawn.kind === 'corridor'
      ? createGeofence({ name: name.trim(), kind: 'corridor', color, line: drawn.geometry, bufferM })
      : createGeofence({ name: name.trim(), kind: drawn.kind, color, geometry: drawn.geometry })
    created
      .then(() => {
        setName(''); clearDraw(); setDraftKind(null)
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
            <AdminButton disabled={drawn === null || name.trim() === '' || saving} data-testid="gf-save" onClick={save}>
              <Check className="h-4 w-4" aria-hidden />
              {t('geofences.save')}
            </AdminButton>
          </>
        ) : (
          <div className="flex gap-1">
            {/* mode buttons double as draft entry points (terra-draw needs the shape kind up
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
                <div className="text-sm font-semibold" style={{ color: 'var(--admin-ink)' }}>{t('geofences.new')}</div>
                <div className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('geofences.draftHint')}</div>
              </div>
              <div>
                <AdminLabel>{t('geofences.name')}</AdminLabel>
                <AdminInput value={name} onChange={(e) => setName(e.target.value)} data-testid="gf-name" />
              </div>
              <div>
                <AdminLabel>{t('geofences.type')}</AdminLabel>
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
              </div>
              <div>
                <AdminLabel>{t('geofences.color')}</AdminLabel>
                {/* curated swatch row (reference) — arbitrary colors still arrive via branding */}
                <div className="flex gap-2" data-testid="gf-color">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
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
              <div className="rounded-md p-2 text-xs" style={{ background: 'var(--admin-surface-sunken)', color: 'var(--admin-ink-soft)' }}>
                {t(`geofences.hint.${draftKind}`)}
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
          <MapErrorOverlay show={mapError} testId="geofence-map-error" />
          {/* Contextual draw hint while drafting. Two states so "how do I finish?" is never a
              mystery: (1) drawing → the per-shape gesture to CLOSE the shape; (2) once terra-draw
              fires 'finish' (drawn !== null) → an explicit "done, now name it and Save" so the
              user gets unambiguous closure and the next step. terra-draw supplies the crosshair. */}
          {drafting && (
            <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-[min(20rem,calc(100%-2rem))]" data-testid="gf-draw-hint" role="status" aria-live="polite">
              {drawn === null ? (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--admin-surface)', boxShadow: 'var(--admin-shadow-lg)', border: '1px solid var(--admin-brand)' }}>
                  <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--admin-brand)' }} aria-hidden />
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--admin-brand)' }}>{t('geofences.drawing')}</div>
                    <div style={{ color: 'var(--admin-ink-soft)' }}>{t(`geofences.hint.${draftKind}`)}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--admin-success-soft)', boxShadow: 'var(--admin-shadow-lg)', border: '1px solid var(--admin-success)' }} data-testid="gf-draw-done">
                  <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--admin-success)' }} aria-hidden />
                  <div>
                    <div className="font-semibold" style={{ color: 'var(--admin-success)' }}>{t('geofences.drawnTitle')}</div>
                    <div style={{ color: 'var(--admin-ink-soft)' }}>{name.trim() === '' ? t('geofences.drawnNeedName') : t('geofences.drawnReady')}</div>
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
