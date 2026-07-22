import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// mapbox-gl is a browser-only lib; mock it so lib/map is importable under node.
// The throwing Map mirrors the REAL v3 failure mode: an empty/missing access token
// with a mapbox:// style throws SYNCHRONOUSLY from the constructor (normalizeStyleURL).
const mapCtor = vi.fn(() => {
  throw new Error('An API access token is required to use Mapbox GL')
})
vi.mock('mapbox-gl', () => ({
  default: {
    accessToken: '',
    Map: class {
      constructor() {
        mapCtor()
      }
    },
  },
}))

import { createThemedMap, emphasizeAdminBoundaries, shrinkRoadShields, styleForTheme, watchMapLoad } from '../src/lib/map.js'

type StyleLoadHandler = () => void
/** Minimal stand-in for the two Map members watchMapLoad touches. */
function fakeMap() {
  const handlers: StyleLoadHandler[] = []
  return {
    handlers,
    on: (ev: string, fn: StyleLoadHandler) => {
      if (ev === 'style.load') handlers.push(fn)
    },
    off: (ev: string, fn: StyleLoadHandler) => {
      if (ev === 'style.load') handlers.splice(handlers.indexOf(fn), 1)
    },
  }
}

describe('styleForTheme (ADR-030)', () => {
  it('defaults to the premium navigation styles per theme (clearer roads + borders)', () => {
    // VITE_MAPBOX_STYLE_DARK/_LIGHT are unset in the test env → library defaults
    expect(styleForTheme('dark')).toBe('mapbox://styles/mapbox/navigation-night-v1')
    expect(styleForTheme('light')).toBe('mapbox://styles/mapbox/navigation-day-v1')
  })
})

describe('emphasizeAdminBoundaries (border legibility)', () => {
  it('boosts country + region borders when the layers exist', () => {
    const props: { layer: string; prop: string }[] = []
    const map = {
      getLayer: (id: string) => (id.startsWith('admin-') ? { id } : undefined),
      setPaintProperty: (layer: string, prop: string) => props.push({ layer, prop }),
    } as unknown as Parameters<typeof emphasizeAdminBoundaries>[0]
    emphasizeAdminBoundaries(map, 'dark')
    expect(props.some((p) => p.layer === 'admin-0-boundary' && p.prop === 'line-color')).toBe(true)
    expect(props.some((p) => p.layer === 'admin-0-boundary' && p.prop === 'line-width')).toBe(true)
    expect(props.some((p) => p.layer === 'admin-1-boundary')).toBe(true)
  })

  it('is a silent no-op when the style has no admin layers (offline dev/e2e style)', () => {
    const map = {
      getLayer: () => undefined,
      setPaintProperty: () => {
        throw new Error('should not be called')
      },
    } as unknown as Parameters<typeof emphasizeAdminBoundaries>[0]
    expect(() => emphasizeAdminBoundaries(map, 'light')).not.toThrow()
  })
})

describe('shrinkRoadShields (road-number badge size)', () => {
  it('scales down icon + text only on *-shield symbol layers', () => {
    const touched: { layer: string; prop: string }[] = []
    const map = {
      getStyle: () => ({ layers: [{ id: 'road-number-shield' }, { id: 'road-label' }, { id: 'admin-0-boundary' }] }),
      setLayoutProperty: (layer: string, prop: string) => touched.push({ layer, prop }),
    } as unknown as Parameters<typeof shrinkRoadShields>[0]
    shrinkRoadShields(map)
    expect(touched.every((tch) => tch.layer === 'road-number-shield')).toBe(true) // never a non-shield layer
    expect(touched.some((tch) => tch.prop === 'icon-size')).toBe(true)
    expect(touched.some((tch) => tch.prop === 'text-size')).toBe(true)
  })

  it('is a silent no-op when the style has no shield layers (offline dev/e2e style)', () => {
    const map = {
      getStyle: () => ({ layers: [{ id: 'background' }] }),
      setLayoutProperty: () => {
        throw new Error('should not be called')
      },
    } as unknown as Parameters<typeof shrinkRoadShields>[0]
    expect(() => shrinkRoadShields(map)).not.toThrow()
  })
})

describe('createThemedMap null-map fallback (HIGH: no route crash on bad token)', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('returns map:null and a callable unsubscribe when the constructor throws', () => {
    const { map, unsubscribe } = createThemedMap({} as HTMLElement)
    expect(mapCtor).toHaveBeenCalled()
    expect(map).toBeNull()
    expect(() => unsubscribe()).not.toThrow() // effect cleanup must stay safe
  })
})

describe('watchMapLoad (silent-blank-map watchdog)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports failure immediately for a null map (construction already failed)', () => {
    const onError = vi.fn()
    const stop = watchMapLoad(null, onError)
    expect(onError).toHaveBeenCalledExactlyOnceWith(true)
    expect(() => stop()).not.toThrow()
  })

  it('reports failure when no style.load lands within the timeout', () => {
    const map = fakeMap()
    const onError = vi.fn()
    watchMapLoad(map as never, onError, 8000)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(8001)
    expect(onError).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('clears the error when a style.load beats the timer late (no latched overlay)', () => {
    const map = fakeMap()
    const onError = vi.fn()
    watchMapLoad(map as never, onError, 8000)
    vi.advanceTimersByTime(8001)
    expect(onError).toHaveBeenLastCalledWith(true)
    for (const fn of map.handlers) fn() // the style finally loads
    expect(onError).toHaveBeenLastCalledWith(false)
  })

  it('stays quiet when the style loads in time, and cleanup detaches the listener', () => {
    const map = fakeMap()
    const onError = vi.fn()
    const stop = watchMapLoad(map as never, onError, 8000)
    for (const fn of map.handlers) fn()
    expect(onError).toHaveBeenCalledExactlyOnceWith(false)
    vi.advanceTimersByTime(10_000) // timer was beaten — must not flip to true
    expect(onError).toHaveBeenCalledExactlyOnceWith(false)
    stop()
    expect(map.handlers).toHaveLength(0)
  })
})
