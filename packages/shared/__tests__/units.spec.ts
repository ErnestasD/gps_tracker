import { describe, expect, it } from 'vitest'

import {
  distanceFromM,
  hoursFromS,
  kmToMi,
  kmhToMph,
  lToGal,
  miToKm,
  sanitizeUnits,
  speedFromKmh,
  volumeFromL,
  KM_PER_MI,
  L_PER_GAL,
  METRIC_UNITS,
} from '../src/units.js'

/**
 * These factors are shared by the browser and the worker, so this file is the one place the
 * dashboard and an emailed report are pinned to the same arithmetic.
 */
describe('unit conversion factors are exact by definition', () => {
  it('the international mile is 1609.344 m and round-trips', () => {
    expect(KM_PER_MI).toBe(1.609344)
    expect(kmToMi(1.609344)).toBe(1)
    expect(miToKm(1)).toBe(1.609344)
    expect(kmToMi(miToKm(42))).toBeCloseTo(42, 12)
  })
  it('the US liquid gallon is 3.785411784 L', () => {
    expect(L_PER_GAL).toBe(3.785411784)
    expect(lToGal(3.785411784)).toBe(1)
  })
  it('60 mph is 96.56064 km/h', () => {
    expect(kmhToMph(96.56064)).toBeCloseTo(60, 12)
  })
})

describe('display conversion', () => {
  it('metres → the chosen distance unit at one decimal', () => {
    expect(distanceFromM(16093.44, 'km')).toBe(16.1)
    expect(distanceFromM(16093.44, 'mi')).toBe(10)
    expect(distanceFromM(0, 'mi')).toBe(0)
  })
  it('speeds are whole numbers — a GPS speed has no meaningful tenth', () => {
    expect(speedFromKmh(95.4, 'kmh')).toBe(95)
    expect(speedFromKmh(96.56064, 'mph')).toBe(60)
  })
  it('litres → gallons and seconds → hours at one decimal', () => {
    expect(volumeFromL(3.785411784, 'gal')).toBe(1)
    expect(volumeFromL(41.55, 'l')).toBe(41.6)
    expect(hoursFromS(5400)).toBe(1.5)
  })
  it('never throws on a degenerate number — an email renderer must not crash on bad data', () => {
    expect(() => distanceFromM(NaN, 'mi')).not.toThrow()
    expect(() => speedFromKmh(Infinity, 'mph')).not.toThrow()
    expect(distanceFromM(-1000, 'km')).toBe(-1)
  })
})

describe('sanitizeUnits', () => {
  it('reads a DB row (unitSpeed…) and a DisplayUnits value (speed…) alike', () => {
    expect(sanitizeUnits({ unitSpeed: 'mph', unitDistance: 'mi', unitVolume: 'gal' })).toEqual({ speed: 'mph', distance: 'mi', volume: 'gal' })
    expect(sanitizeUnits({ speed: 'mph', distance: 'mi', volume: 'gal' })).toEqual({ speed: 'mph', distance: 'mi', volume: 'gal' })
  })
  it('falls back per FIELD — a bad column never drags the others to metric', () => {
    expect(sanitizeUnits({ unitSpeed: 'knots', unitDistance: 'mi', unitVolume: null })).toEqual({ speed: 'kmh', distance: 'mi', volume: 'l' })
  })
  it('an INVALID value does not shadow a valid sibling key', () => {
    // with `??` the junk `speed` won because it was merely present; the first VALID one must win
    expect(sanitizeUnits({ speed: 'knots', unitSpeed: 'mph' })).toEqual({ speed: 'mph', distance: 'km', volume: 'l' })
  })
  it('anything that is not an object yields metric, never a throw', () => {
    for (const v of [undefined, null, 'mph', 42, [], NaN]) expect(sanitizeUnits(v)).toEqual(METRIC_UNITS)
  })
})
