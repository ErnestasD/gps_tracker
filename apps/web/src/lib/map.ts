/**
 * Central Mapbox GL bootstrap (ADR-030): token wiring + theme-reactive premium styles.
 * The ONLY place the map style/token are read — every surface builds its map here so a
 * provider/style change stays an env change, zero code.
 */
import mapboxgl, { type MapOptions } from 'mapbox-gl'

// relative (not '@/') so the vitest suite can import this module without alias config
import { getTheme, onThemeChange, type Theme } from './prefs'

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

/**
 * Scale a symbol size that may be a plain number OR a zoom expression.
 *
 * `["*", 0.45, <existing>]` looked obvious and was wrong: Mapbox requires `["zoom"]` to be the
 * direct input of a TOP-LEVEL `step`/`interpolate`, so wrapping a zoom-dependent size produced
 * "\"zoom\" expression may only be used as input to a top-level..." on every style load — and
 * mapbox-gl rejects the property rather than throwing, so the shields never actually shrank while
 * the console filled up. The navigation styles' shields are exactly that shape:
 * `["interpolate", ["exponential", 1.5], ["zoom"], 6, 0.5, 13, 0.5, 22, 1]`.
 *
 * So scale the OUTPUTS in place and leave the expression's structure alone. Anything whose shape we
 * do not recognise returns null and is left untouched — an unscaled shield is a cosmetic
 * disappointment; an invalid expression is an error on every load.
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
 * styles render large enough to crowd a fleet map (founder feedback). Idempotent: `setStyle` resets
 * to the style's own values before each `style.load`, so this scales the original once and never
 * compounds. A shield-less style is a no-op.
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

const SHIELD_SCALE = 0.45

/**
 * Drop the traffic and incident data the fleet map deliberately does not show.
 *
 * Hiding the layers was not enough on two counts. The incident layers are named `incident-*`, not
 * `traffic-*`, so they were never hidden at all — they were merely empty, because this token has no
 * entitlement to `mapbox-incidents-v1`, which is where the founder's console 403s came from. And a
 * hidden layer still makes its source fetch tiles: bandwidth spent, and an error logged per tile,
 * on every pan.
 *
 * Removing the SOURCE stops the requests. Layers must go first — mapbox-gl refuses to remove a
 * source still in use — and every removal is guarded, so a style carrying neither is a no-op.
 */
export function dropTrafficSources(map: mapboxgl.Map): void {
  const style = map.getStyle()
  if (style === undefined) return
  for (const sourceId of ['mapbox-traffic', 'mapbox-incidents']) {
    if (map.getSource(sourceId) === undefined) continue
    for (const layer of style.layers ?? []) {
      if ((layer as { source?: string }).source !== sourceId) continue
      try {
        map.removeLayer(layer.id)
      } catch {
        /* already gone */
      }
    }
    try {
      map.removeSource(sourceId)
    } catch {
      /* a layer we could not remove still holds it — leaving it costs only the old behaviour */
    }
  }
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
  let map: mapboxgl.Map
  try {
    map = new mapboxgl.Map({
      container,
      style: styleForTheme(getTheme()),
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
  // lift country/region borders on the initial style AND after every theme swap (style.load
  // fires for both). Registered here so EVERY map surface gets it with zero per-surface code.
  map.on('style.load', () => {
    emphasizeAdminBoundaries(map, getTheme())
    shrinkRoadShields(map)
    dropTrafficSources(map)
  })
  let current: Theme = getTheme()
  const unsubscribe = onThemeChange(() => {
    const next = getTheme()
    if (next === current) return
    current = next
    onBeforeStyleSwap?.()
    map.setStyle(styleForTheme(next))
  })
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
