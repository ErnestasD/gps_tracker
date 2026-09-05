import type { Map as MbMap, Marker } from 'mapbox-gl'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isNullIsland } from '@orbetra/shared'

import { MapErrorOverlay } from '@/components/MapErrorOverlay'
import { applyBranding, type Branding } from '@/lib/branding'
import { useFmt } from '@/lib/datetime'
import { mapboxgl, styleForTheme, watchMapLoad } from '@/lib/map'
import { brandFromResponse } from '@/lib/publicBranding'
import { expiryLabel, fetchPublicBranding, fetchPublicShare, type PublicShare } from '@/lib/share'

const VILNIUS: [number, number] = [25.2797, 54.6872]
const POLL_MS = 15_000

/**
 * PUBLIC live-tracking page (V1-nice) — no login. Resolves a share token to ONE device's latest
 * valid position and polls it. A 404 (expired/revoked/unknown) renders a friendly notice, never a
 * crash. Mapbox attribution stays visible (TOS, ADR-030).
 */
export function SharePage({ token }: { token: string }) {
  const { t } = useTranslation()
  const { dt } = useFmt()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MbMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const [share, setShare] = useState<PublicShare | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'gone' | 'error'>('loading')
  const [mapError, setMapError] = useState(false) // constructor threw / style never loaded
  // white-label: wear the reseller tenant's product name/logo (resolved by Host) instead of the
  // hardcoded Orbetra brand — the public link is served on the tenant's own custom domain
  const [branding, setBranding] = useState<Branding | null>(null)
  const [productName, setProductName] = useState<string | null>(null)
  // null = UNKNOWN (in flight or the lookup failed). The attribution below renders only once this
  // is definitively false — it used to show on first paint for every tenant, and forever for one
  // that set colours but no product name.
  const [isPlatform, setIsPlatform] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    void fetchPublicBranding().then((res) => {
      if (!alive) return
      const b = brandFromResponse(res)
      if (b === null) return // failed: stay unknown, show neither brand
      setIsPlatform(!b.whiteLabel)
      applyBranding({ ...b.branding, ...(b.productName !== undefined ? { productName: b.productName } : {}) }, b.whiteLabel) // accents + title
      setBranding(b.branding)
      setProductName(b.productName ?? b.branding.productName ?? null)
    })
    return () => { alive = false }
  }, [])

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
    let map: MbMap | null = null
    try {
      map = new mapboxgl.Map({
        container,
        style: styleForTheme(prefersLight ? 'light' : 'dark'), // dark-first, like the app shell
        center: VILNIUS,
        zoom: 12,
        // Mapbox attribution + logo stay visible on every map view (TOS, ADR-030)
        attributionControl: true,
        antialias: true,
      })
    } catch (err) {
      // missing/empty token + mapbox:// style throws synchronously — degrade to the
      // overlay (watchMapLoad below reports it), never a page crash
      console.error('mapbox init failed', err)
    }
    const stopWatch = watchMapLoad(map, setMapError)
    if (map === null) return () => stopWatch()
    const live = map
    live.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    live.on('error', (e) => console.error('mapbox', e.error))
    mapRef.current = live
    return () => { stopWatch(); live.remove(); mapRef.current = null }
  }, [])

  /**
   * The one position a CUSTOMER sees, and the one that had no guard.
   *
   * `readLatestValidPosition` filters on fix_valid, which is exactly the column a stored 0/0 lies
   * in — and the repair migration deliberately stops at 14 days, so older rows keep lying forever.
   * An unplaceable position must remove the marker, not leave the last one standing somewhere it no
   * longer means.
   */
  const sharePos = share?.position
  const placeable = sharePos !== undefined && sharePos !== null && !isNullIsland(sharePos.lat, sharePos.lon)

  // move the marker on new positions
  useEffect(() => {
    const map = mapRef.current
    const pos = share?.position
    if (!map || !pos || !placeable) {
      markerRef.current?.remove()
      markerRef.current = null
      return
    }
    const lngLat: [number, number] = [pos.lon, pos.lat]
    if (!markerRef.current) markerRef.current = new mapboxgl.Marker({ color: '#7C5CFC' }).setLngLat(lngLat).addTo(map)
    else markerRef.current.setLngLat(lngLat)
    map.easeTo({ center: lngLat, duration: 600 })
  }, [share, placeable])

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
          {/* last-updated: a shared marker can sit on a stale fix (device offline/parked) — show
              the fix time so a viewer can tell a live position from an old one */}
          {share?.position && (
            <span className="text-xs text-muted" data-testid="share-updated">{t('share.updated', { time: dt(share.position.fixTime) })}</span>
          )}
        </div>
        {/* white-label brand: tenant product name/logo when the Host resolves to a tenant, else the
            platform's "Powered by Orbetra" attribution */}
        {/* UNKNOWN host (in flight or a failed lookup) shows nothing at all. "Powered by Orbetra"
            used to render on FIRST PAINT for every tenant — and permanently for one with colours but
            no product name — on the widest-reach surface in the product: a link a reseller sends to
            somebody else's customer. */}
        {productName !== null ? (
          <span className="flex items-center gap-1.5 text-xs text-muted" data-testid="share-brand">
            {branding?.logoUrl != null && branding.logoUrl !== '' && <img src={branding.logoUrl} alt="" className="h-4 w-4" />}
            {productName}
          </span>
        ) : isPlatform === true ? (
          <span className="text-xs text-muted">{t('share.poweredBy')}</span>
        ) : null}
      </header>

      <div className="relative flex-1">
        {/* h/w, NOT absolute+inset: mapbox-gl.css stamps `.mapboxgl-map{position:relative}` onto
            this div, and that rule is UNLAYERED while Tailwind's `.absolute` lives in
            `@layer utilities` — unlayered always wins the cascade, whatever the source order. With
            position:relative, `inset-0` sizes nothing and the empty div collapses (found live on
            this page: header fine, canvas 2906×600, container 1453×0, no tile request ever made).
            LiveMap hit exactly this and was fixed; the public share page kept the old markup. */}
        <div ref={containerRef} className="h-full w-full" data-testid="share-map" />
        <MapErrorOverlay show={mapError} testId="share-map-error" variant="shell" />
        {state === 'gone' && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/80" data-testid="share-gone">
            <div className="rounded-card border border-line bg-surface p-6 text-center">
              <p className="text-lg font-semibold">{t('share.expiredTitle')}</p>
              <p className="mt-1 text-sm text-muted">{t('share.expiredBody')}</p>
            </div>
          </div>
        )}
        {state === 'ok' && share && !placeable && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-card border border-line bg-surface px-3 py-2 text-sm text-muted" data-testid="share-nofix">
            {t('share.noFix')}
          </div>
        )}
        {/* an initial 500/network failure used to leave a blank Vilnius map with no message —
            distinguish it from the expired ('gone') notice with a visible error card */}
        {state === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/80" data-testid="share-error">
            <div className="rounded-card border border-line bg-surface p-6 text-center">
              <p className="text-lg font-semibold">{t('share.errorTitle')}</p>
              <p className="mt-1 text-sm text-muted">{t('share.errorBody')}</p>
            </div>
          </div>
        )}
        {state === 'loading' && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-card border border-line bg-surface px-3 py-2 text-sm text-muted" data-testid="share-loading">
            {t('share.loading')}
          </div>
        )}
      </div>
    </div>
  )
}
