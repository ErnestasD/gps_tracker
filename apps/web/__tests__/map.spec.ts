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

import { createThemedMap, emphasizeAdminBoundaries, hideTrafficLayers, scaleSizeExpression, shrinkRoadShields, styleForTheme, watchMapLoad } from '../src/lib/map.js'

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
    const touched: { layer: string; prop: string; value: unknown }[] = []
    const map = {
      getStyle: () => ({ layers: [{ id: 'road-number-shield' }, { id: 'road-label' }, { id: 'admin-0-boundary' }] }),
      getLayoutProperty: () => ['interpolate', ['linear'], ['zoom'], 6, 1], // pretend the style set a size
      setLayoutProperty: (layer: string, prop: string, value: unknown) => touched.push({ layer, prop, value }),
    } as unknown as Parameters<typeof shrinkRoadShields>[0]
    shrinkRoadShields(map)
    expect(touched.every((tch) => tch.layer === 'road-number-shield')).toBe(true) // never a non-shield layer
    expect(touched.some((tch) => tch.prop === 'icon-size')).toBe(true)
    expect(touched.some((tch) => tch.prop === 'text-size')).toBe(true)
    // Scales the existing value rather than overwriting with an absolute size — but as a
    // RESTRUCTURED expression, not `["*", f, …]`. That wrapper buried ["zoom"] below the top level,
    // which Mapbox rejects outright: the console filled with "zoom expression may only be used as
    // input to a top-level step or interpolate" and the shields never shrank at all.
    expect(touched.every((tch) => Array.isArray(tch.value) && (tch.value as unknown[])[0] === 'interpolate')).toBe(true)
    expect(touched[0]!.value).toEqual(['interpolate', ['linear'], ['zoom'], 6, 0.45])
  })

  it('is a silent no-op when the style has no shield layers (offline dev/e2e style)', () => {
    const map = {
      getStyle: () => ({ layers: [{ id: 'background' }] }),
      getLayoutProperty: () => undefined,
      setLayoutProperty: () => {
        throw new Error('should not be called')
      },
    } as unknown as Parameters<typeof shrinkRoadShields>[0]
    expect(() => shrinkRoadShields(map)).not.toThrow()
  })
})

describe('hideTrafficLayers (fleet-map declutter)', () => {
  it('hides every traffic-* layer, leaves the rest', () => {
    const hidden: string[] = []
    const map = {
      getStyle: () => ({ layers: [{ id: 'traffic' }, { id: 'traffic-road-oneway-arrow' }, { id: 'road-label' }] }),
      setLayoutProperty: (layer: string, prop: string, value: unknown) => {
        if (prop === 'visibility' && value === 'none') hidden.push(layer)
      },
    } as unknown as Parameters<typeof hideTrafficLayers>[0]
    hideTrafficLayers(map)
    expect(hidden).toEqual(['traffic', 'traffic-road-oneway-arrow'])
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

describe('scaleSizeExpression (why the shields are not just multiplied)', () => {
  it('scales a plain number', () => {
    expect(scaleSizeExpression(2, 0.45)).toBe(0.9)
  })

  it('scales the OUTPUTS of an interpolate, leaving the zoom input top-level', () => {
    // the real navigation-night-v1 shield size
    const real = ['interpolate', ['exponential', 1.5], ['zoom'], 6, 0.5, 13, 0.5, 22, 1]
    expect(scaleSizeExpression(real, 0.5)).toEqual(
      ['interpolate', ['exponential', 1.5], ['zoom'], 6, 0.25, 13, 0.25, 22, 0.5],
    )
  })

  it('scales the outputs of a step, including the one before the first stop', () => {
    expect(scaleSizeExpression(['step', ['zoom'], 1, 10, 2, 15, 4], 0.5)).toEqual(
      ['step', ['zoom'], 0.5, 10, 1, 15, 2],
    )
  })

  it('leaves the stops alone — scaling those would move the zoom levels, not the size', () => {
    const out = scaleSizeExpression(['interpolate', ['linear'], ['zoom'], 6, 1, 22, 2], 0.5) as unknown[]
    expect(out[3]).toBe(6)
    expect(out[5]).toBe(22)
  })

  it('refuses a shape it does not understand rather than emitting something invalid', () => {
    // an unscaled shield is a cosmetic disappointment; an invalid expression is an error per load
    expect(scaleSizeExpression(['*', 2, ['zoom']], 0.5)).toBeNull()
    expect(scaleSizeExpression(['interpolate', ['linear'], ['zoom'], 6, ['get', 'size']], 0.5)).toBeNull()
    expect(scaleSizeExpression(undefined, 0.5)).toBeNull()
    expect(scaleSizeExpression('big', 0.5)).toBeNull()
  })
})
