import { describe, expect, it } from 'vitest'

import { DEFAULT_LAYERS, loadLayers, saveLayers, type MapLayers } from '../src/lib/mapLayers'

const store = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: () => map,
  }
}

/**
 * Layer choices are a working setup, not a preference — an operator who turned zones off to read a
 * dense city must not get them back on the next reload.
 */
describe('map layers', () => {
  it('round-trips through storage', () => {
    const s = store()
    const chosen: MapLayers = { ...DEFAULT_LAYERS, heat: true, geofences: false }
    saveLayers(chosen, s)
    expect(loadLayers(s)).toEqual(chosen)
  })

  it('nothing stored means the defaults, not an empty set of layers', () => {
    expect(loadLayers(store())).toEqual(DEFAULT_LAYERS)
  })

  it('a blob from an older build never widens the type', () => {
    // an unknown key is dropped, and a known key of the wrong type falls back to its default —
    // `layers.heat = "yes"` reaching setLayoutProperty is a runtime error inside the map
    const s = store({ 'orbetra.map.layers': JSON.stringify({ heat: 'yes', ghosts: true, labels: true }) })
    const out = loadLayers(s)
    expect(out).toEqual({ ...DEFAULT_LAYERS, labels: true })
    expect('ghosts' in out).toBe(false)
  })

  it('unreadable storage is not a broken map', () => {
    const broken = { getItem: () => '{oops', setItem: () => undefined }
    expect(loadLayers(broken)).toEqual(DEFAULT_LAYERS)
    const throwing = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
    }
    expect(loadLayers(throwing)).toEqual(DEFAULT_LAYERS)
    expect(() => saveLayers(DEFAULT_LAYERS, throwing)).not.toThrow()
  })
})
