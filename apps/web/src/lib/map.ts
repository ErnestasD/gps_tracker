/**
 * Central Mapbox GL bootstrap (ADR-030): token wiring + theme-reactive premium styles.
 * The ONLY place the map style/token are read — every surface builds its map here so a
 * provider/style change stays an env change, zero code.
 */
import mapboxgl, { type MapOptions } from 'mapbox-gl'

import { getTheme, onThemeChange, type Theme } from '@/lib/prefs'

// pk. tokens are public by design — they ship in the client bundle (config, not a
// secret; rule 12 unaffected). URL-restricted in the Mapbox dashboard (ADR-030).
mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? ''

/**
 * Premium Mapbox style per theme (ADR-030 "premium in both themes"). Env overrides let
 * dev/e2e point at the offline `public/dev-style.json` — no tile network, zero code change.
 */
export function styleForTheme(theme: Theme): string {
  return theme === 'dark'
    ? ((import.meta.env.VITE_MAPBOX_STYLE_DARK as string | undefined) ?? 'mapbox://styles/mapbox/dark-v11')
    : ((import.meta.env.VITE_MAPBOX_STYLE_LIGHT as string | undefined) ?? 'mapbox://styles/mapbox/light-v11')
}

export interface ThemedMap {
  map: mapboxgl.Map
  /** Detaches the theme listener — call it right before `map.remove()`. */
  unsubscribe: () => void
}

/**
 * Map bound to the app theme (lib/prefs): starts on the current theme's style and
 * live-swaps via `setStyle` on every theme change. `setStyle` DROPS all runtime
 * sources/layers/images, so callers MUST register theirs inside
 * `map.on('style.load', setup)` with an IDEMPOTENT `setup` (guard on
 * `map.getSource(id)` / `map.hasImage(id)`) — `style.load` fires for the initial
 * style AND after every theme swap, which is what keeps custom layers alive.
 */
export function createThemedMap(container: HTMLElement, opts: Omit<MapOptions, 'container' | 'style'> = {}): ThemedMap {
  const map = new mapboxgl.Map({
    container,
    style: styleForTheme(getTheme()),
    // Mapbox attribution + logo stay visible on every map view (TOS, ADR-030)
    attributionControl: true,
    antialias: true,
    ...opts,
  })
  let current: Theme = getTheme()
  const unsubscribe = onThemeChange(() => {
    const next = getTheme()
    if (next === current) return
    current = next
    map.setStyle(styleForTheme(next))
  })
  return { map, unsubscribe }
}

// Re-exported so surfaces get controls/markers from the module that set the token —
// importing 'mapbox-gl' directly elsewhere risks a map before the token assignment ran.
export { mapboxgl }
