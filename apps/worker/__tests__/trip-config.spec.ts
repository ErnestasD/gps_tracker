import { describe, expect, it } from 'vitest'

import { DEFAULT_THRESHOLDS } from '../src/trip/engine.js'
import { asOdometerSource, deviceTripConfig, thresholdsFromRules } from '../src/trip/config.js'

describe('E04-5 device trip config', () => {
  it('thresholdsFromRules fills omitted keys from DEFAULT_THRESHOLDS', () => {
    // the seeded asset profile presence_rules (partial)
    const asset = thresholdsFromRules({ noIgnition: true, moveSpeedKmh: 3, movingSustainS: 300, parkedDisplaceM: 100 })
    expect(asset.noIgnition).toBe(true)
    expect(asset.moveSpeedKmh).toBe(3)
    expect(asset.movingSustainS).toBe(300)
    expect(asset.parkedDisplaceM).toBe(100)
    // keys the profile omits fall back to defaults
    expect(asset.movingDisplaceM).toBe(DEFAULT_THRESHOLDS.movingDisplaceM)
    expect(asset.idleSpeedKmh).toBe(DEFAULT_THRESHOLDS.idleSpeedKmh)
    expect(asset.parkedStopS).toBe(DEFAULT_THRESHOLDS.parkedStopS)
  })

  it('thresholdsFromRules(null/empty) === DEFAULT_THRESHOLDS', () => {
    expect(thresholdsFromRules(null)).toEqual(DEFAULT_THRESHOLDS)
    expect(thresholdsFromRules({})).toEqual(DEFAULT_THRESHOLDS)
  })

  it('rejects garbage AND negative values (M1) → default; noIgnition only on true', () => {
    const t = thresholdsFromRules({ moveSpeedKmh: 'fast', noIgnition: 'yes', movingSustainS: -1, parkedStopS: -50 })
    expect(t.moveSpeedKmh).toBe(DEFAULT_THRESHOLDS.moveSpeedKmh)
    expect(t.movingSustainS).toBe(DEFAULT_THRESHOLDS.movingSustainS) // negative → default (would open on record 1)
    expect(t.parkedStopS).toBe(DEFAULT_THRESHOLDS.parkedStopS)
    expect(t.noIgnition).toBe(false) // only literal true enables it
  })

  it('asOdometerSource validates the enum, defaulting to auto', () => {
    expect(asOdometerSource('device')).toBe('device')
    expect(asOdometerSource('gps')).toBe('gps')
    expect(asOdometerSource('auto')).toBe('auto')
    expect(asOdometerSource('nonsense')).toBe('auto')
    expect(asOdometerSource(undefined)).toBe('auto')
  })

  it('deviceTripConfig bundles thresholds + odometerSource', () => {
    const c = deviceTripConfig({ noIgnition: true }, 'gps')
    expect(c.thresholds.noIgnition).toBe(true)
    expect(c.odometerSource).toBe('gps')
  })
})
