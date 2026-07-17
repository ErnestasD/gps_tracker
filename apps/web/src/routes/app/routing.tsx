import type { RouteOptimizeResult } from '@orbetra/shared'
import type { GeoJSONSource, Map as MbMap } from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminButton, AdminCheckbox, PageHeader } from '@/components/admin/AdminKit'
import { MapErrorOverlay } from '@/components/MapErrorOverlay'
import { ApiError } from '@/lib/http'
import { createThemedMap, mapboxgl, watchMapLoad } from '@/lib/map'
import { optimizeRoute, parseStopsText } from '@/lib/routing'
import { fmtDuration } from '@/lib/trips'
import { useUnits } from '@/lib/units'

const VILNIUS: [number, number] = [25.2797, 54.6872]
// ADR-028 palette (PlaybackMap COLORS): route = --accent, stop markers = cursor purple
const COLORS = { route: '#7C7DF5', stop: '#7C5CFC' }

const emptyFC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Numbered stop points: the optimized order once a result exists, else the input order. */
function stopFeatures(stops: { lat: number; lon: number; label?: string }[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stops.map((s, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { n: String(i + 1), label: s.label ?? '' },
    })),
  }
}

/** Route planner (ADR-029): paste/click stops, OSRM-optimize the visiting order, see the road path. */
export function RoutePlannerPage() {
  const { t } = useTranslation()
  const u = useUnits()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MbMap | null>(null)
  // bumps on EVERY style.load (initial + theme swaps, ADR-030) so the stops/route
  // effect re-applies its data to the freshly rebuilt (empty) sources
  const [styleEpoch, setStyleEpoch] = useState(0)
  const [mapError, setMapError] = useState(false) // constructor threw / style never loaded
  const [text, setText] = useState('')
  const [roundtrip, setRoundtrip] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RouteOptimizeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parsed = parseStopsText(text)

  // map lifecycle (copied from geofences.tsx, minus terra-draw)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const { map, unsubscribe } = createThemedMap(container, { center: VILNIUS, zoom: 10 })
    // if the base map never loads, the click-to-add flow is silently dead — surface it
    // (8s watchdog; also fires immediately when construction failed, clears on style.load)
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
    // idempotent: style.load re-fires after every theme setStyle (layers were dropped)
    map.on('style.load', () => {
      if (disposed) return
      if (!map.getSource('route')) {
        map.addSource('route', { type: 'geojson', data: emptyFC })
        map.addSource('stops', { type: 'geojson', data: emptyFC })
        map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': COLORS.route, 'line-width': 3, 'line-opacity': 0.9 } })
        map.addLayer({ id: 'stops-circle', type: 'circle', source: 'stops', paint: { 'circle-radius': 9, 'circle-color': COLORS.stop, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })
        // visit numbers on the markers — Mapbox-hosted font stack (same as LiveMap's
        // cluster-count); the offline dev/e2e style has no glyphs, so skip there
        if (map.getStyle()?.glyphs !== undefined) {
          map.addLayer({ id: 'stops-order', type: 'symbol', source: 'stops', layout: { 'text-field': ['get', 'n'], 'text-size': 11, 'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } })
        }
      }
      setStyleEpoch((e) => e + 1)
    })
    // map-level (non-layer) handler: registered once, unaffected by theme setStyle.
    // click appends a stop line to the textarea (no address search — no Photon proxy in v1)
    map.on('click', (e) => {
      const line = `${e.lngLat.wrap().lat.toFixed(5)},${e.lngLat.wrap().lng.toFixed(5)}`
      setText((prev) => (prev.trimEnd() === '' ? `${line}\n` : `${prev.trimEnd()}\n${line}\n`))
      setResult(null)
    })
    return () => {
      disposed = true
      stopWatch()
      unsubscribe()
      map.remove()
      mapRef.current = null
      setStyleEpoch(0)
    }
  }, [])

  // stops + route on the map (re-applied after every theme swap); fit bounds when an
  // optimized result lands
  useEffect(() => {
    const map = mapRef.current
    if (map === null || styleEpoch === 0) return
    const stops = result?.stops ?? parsed.stops
    map.getSource<GeoJSONSource>('stops')?.setData(stopFeatures(stops))
    map.getSource<GeoJSONSource>('route')?.setData(
      result === null ? emptyFC : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: result.geometry, properties: {} }] },
    )
    if (result !== null && result.geometry.coordinates.length > 0) {
      const first = result.geometry.coordinates[0]!
      const b = new mapboxgl.LngLatBounds(first, first)
      for (const c of result.geometry.coordinates) b.extend(c)
      map.fitBounds(b, { padding: 48, maxZoom: 14, duration: 400 })
    }
  }, [result, text, styleEpoch]) // parsed derives from text

  const optimize = () => {
    if (parsed.stops.length < 2 || parsed.errors.length > 0 || busy) return
    setBusy(true)
    setError(null)
    optimizeRoute({ stops: parsed.stops, roundtrip })
      .then(setResult)
      .catch((err: unknown) => {
        setResult(null)
        setError(err instanceof ApiError && err.status === 422 ? t('routing.errors.unroutable') : err instanceof ApiError && err.status === 429 ? t('routing.errors.rateLimited') : t('routing.errors.unavailable'))
      })
      .finally(() => setBusy(false))
  }

  const canOptimize = parsed.stops.length >= 2 && parsed.stops.length <= 50 && parsed.errors.length === 0 && !busy

  return (
    <div className="flex h-full flex-col gap-3 p-4 md:p-6">
      <PageHeader title={t('routing.title')} description={t('routing.desc')} className="mb-0" />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,26rem)_1fr]">
        {/* planner panel */}
        <aside className="admin-card flex min-h-0 flex-col gap-3 overflow-auto p-3">
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--admin-ink-soft)' }}>
            {t('routing.pasteHint')}
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setResult(null) }}
              rows={6}
              placeholder={'54.6872,25.2797,Vilnius HQ\n54.8985,23.9036'}
              data-testid="routing-stops-input"
              className="w-full resize-y rounded-md border px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:opacity-60 focus:ring-2 focus:ring-[var(--admin-brand)]/30"
              style={{ borderColor: 'var(--admin-hairline)', background: 'var(--admin-surface)', color: 'var(--admin-ink)' }}
            />
          </label>
          <p className="text-xs" style={{ color: 'var(--admin-ink-soft)' }}>{t('routing.addByClick')}</p>

          <div className="flex flex-wrap items-center gap-3">
            <AdminCheckbox
              checked={roundtrip}
              onCheckedChange={(v) => { setRoundtrip(v); setResult(null) }}
              label={t('routing.roundtrip')}
              data-testid="routing-roundtrip"
            />
            <AdminButton disabled={!canOptimize} data-testid="routing-optimize" onClick={optimize}>
              {t('routing.optimize')}
            </AdminButton>
          </div>

          {parsed.errors.length > 0 && (
            <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="routing-parse-error">
              {t('routing.errors.parse', { lines: parsed.errors.map((e) => e.line).join(', ') })}
            </p>
          )}
          {error !== null && (
            <p role="alert" className="text-sm" style={{ color: 'var(--admin-danger)' }} data-testid="routing-error">
              {error}
            </p>
          )}

          {result === null ? (
            <p className="py-6 text-center text-sm" style={{ color: 'var(--admin-ink-soft)' }} data-testid="routing-empty">
              {t('routing.empty')}
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="routing-result-table" style={{ color: 'var(--admin-ink)' }}>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider" style={{ color: 'var(--admin-ink-soft)' }}>
                  <th className="px-2 py-1">{t('routing.order')}</th>
                  <th className="px-2 py-1">{t('routing.stop')}</th>
                  <th className="px-2 py-1">{t('routing.leg')}</th>
                </tr>
              </thead>
              <tbody>
                {result.stops.map((s) => {
                  const leg = result.legs[s.visitOrder]
                  return (
                    <tr key={s.visitOrder} className="admin-hairline-t" data-testid={`routing-stop-${s.visitOrder}`}>
                      <td className="px-2 py-1.5">{s.visitOrder + 1}</td>
                      <td className="px-2 py-1.5">{s.label ?? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--admin-ink-soft)' }}>
                        {leg !== undefined ? `${fmtDuration(leg.durationS * 1000)} · ${u.distanceM(leg.distanceM)}` : '—'}
                      </td>
                    </tr>
                  )
                })}
                <tr className="admin-hairline-t font-medium" data-testid="routing-total">
                  <td className="px-2 py-1.5" colSpan={2}>{t('routing.total')}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{`${fmtDuration(result.totalDurationS * 1000)} · ${u.distanceM(result.totalDistanceM)}`}</td>
                </tr>
              </tbody>
            </table>
          )}
        </aside>

        {/* map panel */}
        <div className="admin-card relative min-h-[320px] overflow-hidden lg:min-h-0">
          <div ref={containerRef} className="h-full w-full" data-testid="routing-map" />
          <MapErrorOverlay show={mapError} testId="routing-map-error" />
        </div>
      </div>
    </div>
  )
}
