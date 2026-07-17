import type { Map as MbMap, Marker } from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { mapboxgl, styleForTheme } from '@/lib/map'
import { expiryLabel, fetchPublicShare, type PublicShare } from '@/lib/share'

const VILNIUS: [number, number] = [25.2797, 54.6872]
const POLL_MS = 15_000

/**
 * PUBLIC live-tracking page (V1-nice) — no login. Resolves a share token to ONE device's latest
 * valid position and polls it. A 404 (expired/revoked/unknown) renders a friendly notice, never a
 * crash. Mapbox attribution stays visible (TOS, ADR-030).
 */
export function SharePage({ token }: { token: string }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MbMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const [share, setShare] = useState<PublicShare | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'error'>('loading')

  // poll the public endpoint
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const s = await fetchPublicShare(token)
        if (!alive) return
        if (s === null) { setState('gone'); return }
        setShare(s)
        setState('ok')
      } catch {
        if (alive) setState((prev) => (prev === 'ok' ? 'ok' : 'error')) // keep last good view on a blip
      }
    }
    void tick()
    const iv = setInterval(() => void tick(), POLL_MS)
    return () => { alive = false; clearInterval(iv) }
  }, [token])

  // init map once — this public page has no in-app theme toggle, so the style follows
  // the OS theme, read ONCE at load (no onThemeChange subscription; ADR-030)
  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current) return
    const prefersLight = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches
    const map = new mapboxgl.Map({
      container,
      style: styleForTheme(prefersLight ? 'light' : 'dark'), // dark-first, like the app shell
      center: VILNIUS,
      zoom: 12,
      // Mapbox attribution + logo stay visible on every map view (TOS, ADR-030)
      attributionControl: true,
      antialias: true,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('error', (e) => console.error('mapbox', e.error))
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // move the marker on new positions
  useEffect(() => {
    const map = mapRef.current
    const pos = share?.position
    if (!map || !pos) return
    const lngLat: [number, number] = [pos.lon, pos.lat]
    if (!markerRef.current) markerRef.current = new mapboxgl.Marker({ color: '#7C5CFC' }).setLngLat(lngLat).addTo(map)
    else markerRef.current.setLngLat(lngLat)
    map.easeTo({ center: lngLat, duration: 600 })
  }, [share])

  const now = Date.now()
  const exp = share ? expiryLabel(share.expiresAt, now) : null

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{share?.label ?? t('share.title')}</span>
          {exp && (
            <span className="text-xs text-muted">
              {exp.expired ? t('devices.share.expired') : t(`devices.share.expiresIn.${exp.unit}`, { n: exp.value })}
            </span>
          )}
        </div>
        <span className="text-xs text-muted">{t('share.poweredBy')}</span>
      </header>

      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" data-testid="share-map" />
        {state === 'gone' && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/80" data-testid="share-gone">
            <div className="rounded-card border border-line bg-surface p-6 text-center">
              <p className="text-lg font-semibold">{t('share.expiredTitle')}</p>
              <p className="mt-1 text-sm text-muted">{t('share.expiredBody')}</p>
            </div>
          </div>
        )}
        {state === 'ok' && share && !share.position && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-card border border-line bg-surface px-3 py-2 text-sm text-muted" data-testid="share-nofix">
            {t('share.noFix')}
          </div>
        )}
      </div>
    </div>
  )
}
