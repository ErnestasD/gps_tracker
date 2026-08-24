/**
 * Central Mapbox GL bootstrap (ADR-030): token wiring + theme-reactive premium styles.
 * The ONLY place the map style/token are read — every surface builds its map here so a
 * provider/style change stays an env change, zero code.
 */
import mapboxgl, { type MapOptions, type StyleSpecification } from 'mapbox-gl'

// relative (not '@/') so the vitest suite can import this module without alias config
import { getDisplayPrefs, getTheme, onPrefsChange, onThemeChange, type Theme } from './prefs'

// pk. tokens are public by design — they ship in the client bundle (config, not a
// secret; rule 12 unaffected). URL-restricted in the Mapbox dashboard (ADR-030).
// Lives in the UNTRACKED apps/web/.env (GitHub push protection blocks Mapbox tokens).
mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? ''

/**
 * Premium Mapbox style per theme (ADR-030 "premium in both themes"). Env overrides let
 * dev/e2e point at the offline `public/dev-style.json` — no tile network, zero code change.
 * Defaults are the NAVIGATION styles (not the muted dark-v11/light-v11): clearer roads,
 * more colour, and readable country/region borders — a better fit for a fleet map than the
 * washed-out monochrome bases. `emphasizeAdminBoundaries` further lifts the borders.
 */
export function styleForTheme(theme: Theme): string {
  return theme === 'dark'
    ? ((import.meta.env.VITE_MAPBOX_STYLE_DARK as string | undefined) ?? 'mapbox://styles/mapbox/navigation-night-v1')
    : ((import.meta.env.VITE_MAPBOX_STYLE_LIGHT as string | undefined) ?? 'mapbox://styles/mapbox/navigation-day-v1')
}

/**
 * Lift administrative boundaries so country (admin-0) and region (admin-1) borders read
 * clearly instead of nearly vanishing into the basemap (founder feedback). Runs on every
 * `style.load` (initial + each theme swap). Every property write is guarded — a style
 * without these layers (the offline dev/e2e style) is a silent no-op, never a throw.
 */
export function emphasizeAdminBoundaries(map: mapboxgl.Map, theme: Theme): void {
  // per-theme border colours that read on both the dark and light navigation bases
  const country = theme === 'dark' ? '#9fb0d6' : '#5b6a8c'
  const region = theme === 'dark' ? '#5a6684' : '#9aa6c0'
  const set = (layer: string, prop: 'line-color' | 'line-opacity' | 'line-width', value: unknown): void => {
    try {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value as never)
    } catch {
      /* layer/prop absent on this style — ignore */
    }
  }
  // country borders: brighter colour, fully opaque, a touch wider so they stand out at any zoom
  for (const id of ['admin-0-boundary', 'admin-0-boundary-disputed']) {
    set(id, 'line-color', country)
    set(id, 'line-opacity', 1)
    set(id, 'line-width', ['interpolate', ['linear'], ['zoom'], 2, 0.9, 6, 1.6, 10, 2.4])
  }
  // region (state/province) borders: visible but subordinate to country lines
  set('admin-1-boundary', 'line-color', region)
  set('admin-1-boundary', 'line-opacity', 0.75)
}

/** How much smaller the road-number shields are drawn than the style asks for. */
const SHIELD_SCALE = 0.45

/**
 * Scale a symbol size that may be a plain number OR a zoom expression.
 *
 * `["*", 0.45, <existing>]` looks obvious and is wrong: Mapbox requires `["zoom"]` to be the direct
 * input of a TOP-LEVEL `step`/`interpolate`, so wrapping a zoom-dependent size emits `"zoom"
 * expression may only be used as input to a top-level "step" or "interpolate" expression` on every
 * style load. Worse, mapbox-gl REJECTS the property instead of throwing — so the shields never
 * actually shrank while the console filled up, and the try/catch below could not see it. The
 * navigation styles' shields are exactly that shape:
 * `["interpolate", ["exponential", 1.5], ["zoom"], 6, 0.5, 13, 0.5, 22, 1]`.
 *
 * So scale the OUTPUTS in place and leave the expression's structure alone. The stops are zoom
 * levels, not sizes — scaling those would move WHERE the size changes, not the size. Anything whose
 * shape we do not recognise returns null and is left untouched: an unscaled shield is a cosmetic
 * disappointment, an invalid expression is an error on every single load.
 */
export function scaleSizeExpression(value: unknown, factor: number): number | unknown[] | null {
  if (typeof value === 'number') return value * factor
  if (!Array.isArray(value) || value.length < 3) return null
  // ["interpolate", interpolation, input, stop, out, stop, out, …] → outputs at 4, 6, 8, …
  // ["step", input, out0, stop, out, stop, out, …]                → outputs at 2, 4, 6, …
  const expr = value as unknown[]
  const start = expr[0] === 'interpolate' ? 4 : expr[0] === 'step' ? 2 : -1
  if (start === -1) return null
  const out: unknown[] = [...expr]
  for (let i = start; i < out.length; i += 2) {
    const v = out[i]
    if (typeof v !== 'number') return null // a nested expression — do not guess
    out[i] = v * factor
  }
  return out
}

/**
 * Shrink the road-number shields (the red/yellow A2/M7/P45… route badges), which the navigation
 * styles render large enough to crowd a fleet map (founder feedback). Rather than guess absolute
 * sizes (an earlier attempt overshot and INFLATED them), scale whatever the style set — see
 * `scaleSizeExpression` for why that is not a multiply. Idempotent: setStyle resets to defaults
 * before each style.load, so we scale the original once, never compounding. Guarded per
 * layer/property → shield-less styles are a no-op.
 */
export function shrinkRoadShields(map: mapboxgl.Map): void {
  const layers = map.getStyle()?.layers ?? []
  for (const layer of layers) {
    if (!layer.id.includes('shield')) continue
    for (const prop of ['icon-size', 'text-size'] as const) {
      try {
        const scaled = scaleSizeExpression(map.getLayoutProperty(layer.id, prop) as unknown, SHIELD_SCALE)
        if (scaled !== null) map.setLayoutProperty(layer.id, prop, scaled as never)
      } catch {
        /* not a symbol layer / property absent — ignore */
      }
    }
  }
}

/**
 * Hide the live-traffic congestion overlay (the red/amber/green road tint the navigation styles
 * paint on by default). On a fleet map it is visual noise that competes with the vehicles and their
 * trails — the founder read the coloured roads as clutter. Every `traffic-*` layer (congestion tint +
 * one-way direction arrows) is set invisible. Guarded; a style without traffic layers is a no-op.
 */
export function hideTrafficLayers(map: mapboxgl.Map): void {
  const layers = map.getStyle()?.layers ?? []
  for (const layer of layers) {
    if (!layer.id.includes('traffic')) continue
    try {
      map.setLayoutProperty(layer.id, 'visibility', 'none')
    } catch {
      /* ignore */
    }
  }
}

// ── Google basemap (ADR-038) ────────────────────────────────────────────────
// The customer-facing "Google žemėlapis" option keeps Mapbox GL as the RENDERER and swaps only
// the BASEMAP: official Google Map Tiles API raster tiles as a GL raster source. Every runtime
// source/layer (clusters, trails, geofences, the scrub ghost) rides on top unchanged, which is
// what makes "visas funkcionalumas turi veikti" true by construction instead of by re-porting
// four map surfaces to a second SDK. Key lives in the untracked apps/web/.env like the Mapbox
// token; with no key the settings option is disabled (see settings.tsx).

export const GOOGLE_MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) ?? ''

/** The classic Google "night mode" styling array — the documented dark-map recipe, passed to
 * createSession so the DARK preference applies to Google tiles server-side. */
const GOOGLE_DARK_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
]

/** Session tokens are Google's own currency for the Tiles API (valid ~2 weeks) — cached per
 * scheme in localStorage so a reload does not re-create one. */
async function googleSession(scheme: Theme): Promise<string> {
  const cacheKey = `orbetra.gmaptiles.${scheme}`
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as { token?: string; exp?: number } | null
    if (c?.token != null && typeof c.exp === 'number' && c.exp > Date.now()) return c.token
  } catch {
    /* corrupt cache — re-create */
  }
  const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mapType: 'roadmap',
      language: navigator.language || 'en-US',
      region: 'LT',
      ...(scheme === 'dark' ? { styles: GOOGLE_DARK_STYLES } : {}),
    }),
  })
  if (!res.ok) throw new Error(`createSession ${res.status}`)
  const j = (await res.json()) as { session: string; expiry: string | number }
  // expiry is epoch SECONDS; renew an hour early so a tab that stays open never hits a dead session
  const exp = Number(j.expiry) * 1000 - 3_600_000
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ token: j.session, exp }))
  } catch {
    /* storage disabled — the session still serves this page's lifetime */
  }
  return j.session
}

/** A GL style whose base is the Google raster source. Glyphs stay on Mapbox — our symbol layers
 * (device name labels) need a font server, and the Mapbox one is already tokened. */
function googleStyleSpec(session: string): StyleSpecification {
  return {
    version: 8,
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
    sources: {
      'google-tiles': {
        type: 'raster',
        tiles: [`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`],
        tileSize: 256,
        maxzoom: 22,
        attribution: '© Google',
      },
    },
    layers: [{ id: 'google-base', type: 'raster', source: 'google-tiles' }],
  }
}

/** Provider + scheme, resolved from the display prefs ('auto' scheme follows the app theme). */
export function mapPrefs(): { provider: 'mapbox' | 'google'; scheme: Theme } {
  const p = getDisplayPrefs()
  const provider = p.mapProvider === 'google' && GOOGLE_MAPS_KEY !== '' ? 'google' : 'mapbox'
  const scheme: Theme = p.mapScheme === 'auto' ? getTheme() : p.mapScheme
  return { provider, scheme }
}

export interface ThemedMap {
  /** null when the map could not even be constructed (e.g. a missing/empty token with a
   *  mapbox:// style throws SYNCHRONOUSLY from the constructor via normalizeStyleURL) —
   *  callers must render their map-error overlay instead of wiring sources/layers. */
  map: mapboxgl.Map | null
  /** Detaches the theme listener — call it right before `map.remove()`. */
  unsubscribe: () => void
}

export interface ThemedMapOptions extends Omit<MapOptions, 'container' | 'style'> {
  /**
   * Invoked synchronously RIGHT BEFORE a theme swap calls `map.setStyle` — the last
   * moment the outgoing style's runtime sources/layers still exist. Style-coupled
   * plugins (terra-draw) must detach here and re-attach in `style.load`; otherwise a
   * user interaction during the swap window hits their already-dropped sources.
   */
  onBeforeStyleSwap?: () => void
}

/**
 * Map bound to the app theme (lib/prefs): starts on the current theme's style and
 * live-swaps via `setStyle` on every theme change. `setStyle` DROPS all runtime
 * sources/layers/images, so callers MUST register theirs inside
 * `map.on('style.load', setup)` with an IDEMPOTENT `setup` (guard on
 * `map.getSource(id)` / `map.hasImage(id)`) — `style.load` fires for the initial
 * style AND after every theme swap, which is what keeps custom layers alive.
 */
export function createThemedMap(container: HTMLElement, opts: ThemedMapOptions = {}): ThemedMap {
  const { onBeforeStyleSwap, ...mapOpts } = opts
  const initial = mapPrefs()
  let map: mapboxgl.Map
  try {
    map = new mapboxgl.Map({
      container,
      // Google starts on the SAME-scheme Mapbox style and swaps once the tile session lands —
      // a base under the vehicles from the first frame beats a black void while a network
      // round-trip completes, and the swap reuses the ordinary style.load re-setup path.
      style: styleForTheme(initial.scheme),
      // Mapbox attribution + logo stay visible on every map view (TOS, ADR-030)
      attributionControl: true,
      antialias: true,
      ...mapOpts,
    })
  } catch (err) {
    // missing/invalid token + mapbox:// style throws synchronously — degrade to the
    // caller's error overlay (watchMapLoad reports it), never a route crash
    console.error('mapbox init failed', err)
    return { map: null, unsubscribe: () => {} }
  }
  let disposed = false
  // lift country/region borders on the initial style AND after every swap (style.load
  // fires for both). Registered here so EVERY map surface gets it with zero per-surface code.
  // On the Google raster base the admin/shield/traffic tweaks are no-ops by their own guards.
  map.on('style.load', () => {
    emphasizeAdminBoundaries(map, mapPrefs().scheme)
    shrinkRoadShields(map)
    hideTrafficLayers(map)
  })

  /** Apply the CURRENT provider+scheme. Async because the Google session is a network fetch;
   *  a stale application (prefs changed again mid-fetch) is dropped by the key check. */
  let appliedKey = `mapbox:${initial.scheme}` // what the constructor already put on screen
  const apply = () => {
    const { provider, scheme } = mapPrefs()
    const key = `${provider}:${scheme}`
    if (key === appliedKey) return
    appliedKey = key
    if (provider === 'mapbox') {
      onBeforeStyleSwap?.()
      map.setStyle(styleForTheme(scheme))
      return
    }
    void googleSession(scheme)
      .then((session) => {
        if (disposed || appliedKey !== key) return
        onBeforeStyleSwap?.()
        map.setStyle(googleStyleSpec(session))
      })
      .catch((err: unknown) => {
        // an unreachable Tiles API must not strand the operator on a dead map — fall back
        // to the Mapbox style of the same scheme and keep the preference for next time
        console.error('google tiles session failed', err)
        if (disposed || appliedKey !== key) return
        onBeforeStyleSwap?.()
        map.setStyle(styleForTheme(scheme))
      })
  }
  if (initial.provider === 'google') apply() // constructor drew Mapbox; catch up to the pref

  const offTheme = onThemeChange(apply)
  const offPrefs = onPrefsChange(apply)
  const unsubscribe = () => {
    disposed = true
    offTheme()
    offPrefs()
  }
  return { map, unsubscribe }
}

/**
 * Watchdog for the silent-blank-map failure (blocked tile CDN / WebGL failure / bad
 * token): reports `onError(true)` if construction already failed (`map === null`) or
 * if no `style.load` lands within `timeoutMs`, and reports `onError(false)` whenever
 * a `style.load` DOES land — including one that beats the timer late, so the overlay
 * never latches over a working map. Returns a cleanup for the effect teardown.
 */
export function watchMapLoad(map: mapboxgl.Map | null, onError: (failed: boolean) => void, timeoutMs = 8000): () => void {
  if (map === null) {
    onError(true)
    return () => {}
  }
  let loaded = false
  const timer = setTimeout(() => {
    if (!loaded) onError(true)
  }, timeoutMs)
  const onLoad = () => {
    loaded = true
    onError(false)
  }
  map.on('style.load', onLoad)
  return () => {
    clearTimeout(timer)
    map.off('style.load', onLoad)
  }
}

// Re-exported so surfaces get controls/markers from the module that set the token —
// importing 'mapbox-gl' directly elsewhere risks a map before the token assignment ran.
export { mapboxgl }
