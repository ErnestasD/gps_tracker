import { describe, expect, it } from 'vitest'

import { fmtDistanceKm, fmtSpeed, fmtVolumeL, kmToMi, kmhToMph, lToGal, round1 } from '../src/lib/units.js'

/** i18next-shaped stub: returns the localized label per key (with {{n}} interpolation for units.km). */
const t = (key: string, options?: Record<string, unknown>): string => {
  const n = options?.['n']
  const table: Record<string, string> = {
    'units.kmh': 'km/h',
    'units.mph': 'mph',
    'units.mi': 'mi',
    'units.gal': 'gal',
    'units.l': 'l',
    'units.km': `${typeof n === 'number' ? n : ''} km`,
  }
  return table[key] ?? key
}

describe('unit converters (pure)', () => {
  it('kmToMi / kmhToMph use the exact international mile', () => {
    expect(kmToMi(1.609344)).toBeCloseTo(1, 10)
    expect(kmToMi(100)).toBeCloseTo(62.1371, 3)
    expect(kmhToMph(90)).toBeCloseTo(55.923, 2)
  })

  it('lToGal uses the exact US gallon (3.785411784 l)', () => {
    expect(lToGal(3.785411784)).toBeCloseTo(1, 10)
    expect(lToGal(50)).toBeCloseTo(13.2086, 3)
  })

  it('round1 rounds to one decimal without a trailing .0', () => {
    expect(round1(12.34)).toBe(12.3)
    expect(round1(12.0)).toBe(12)
    expect(round1(0.05)).toBe(0.1)
  })
})

describe('fmtSpeed / fmtDistanceKm / fmtVolumeL (localized labels)', () => {
  it('fmtSpeed renders integer km/h or converted mph', () => {
    expect(fmtSpeed(72, 'kmh', t)).toBe('72 km/h')
    expect(fmtSpeed(72, 'mph', t)).toBe('45 mph')
    expect(fmtSpeed(0, 'mph', t)).toBe('0 mph')
  })

  it('fmtDistanceKm renders km via the interpolated key and mi converted', () => {
    expect(fmtDistanceKm(12.34, 'km', t)).toBe('12.3 km')
    expect(fmtDistanceKm(100, 'mi', t)).toBe('62.1 mi')
    expect(fmtDistanceKm(0, 'km', t)).toBe('0 km')
  })

  it('fmtVolumeL renders litres or converted US gallons at 1 decimal', () => {
    expect(fmtVolumeL(41.5, 'l', t)).toBe('41.5 l')
    expect(fmtVolumeL(37.854_117_84, 'gal', t)).toBe('10.0 gal')
  })
})
