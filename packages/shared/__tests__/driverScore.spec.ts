import { describe, expect, it } from 'vitest'

import { driverScore } from '../src/entities.js'

const base = { trips: 5, distanceM: 500_000, maxSpeed: 90, idleS: 0, driveS: 36_000, overspeedEvents: 0 }

describe('V2 driverScore', () => {
  it('a clean driver scores 100', () => {
    expect(driverScore(base)).toBe(100)
  })

  it('null when there are no trips in the window (nothing to score)', () => {
    expect(driverScore({ ...base, trips: 0 })).toBeNull()
  })

  it('penalises overspeed frequency (per 100 km, capped)', () => {
    // 10 overspeed over 500 km = 2 per 100 km → 16 off
    expect(driverScore({ ...base, overspeedEvents: 10 })).toBe(84)
    // heavy overspeeding is capped at −45
    expect(driverScore({ ...base, overspeedEvents: 1000 })).toBe(55)
  })

  it('penalises a high top speed above 100 km/h', () => {
    expect(driverScore({ ...base, maxSpeed: 120 })).toBe(90) // (120-100)*0.5 = 10
    expect(driverScore({ ...base, maxSpeed: 100 })).toBe(100) // at threshold, no penalty
  })

  it('penalises idling as a share of drive time (capped)', () => {
    // 50% idle → (0.5*30)=15 off
    expect(driverScore({ ...base, idleS: 18_000, driveS: 36_000 })).toBe(85)
  })

  it('guards tiny distance so one event does not read as ×1000 per 100 km', () => {
    // 0.1 km with 1 overspeed → treated as 1 event (not 1000/100km) → −8
    expect(driverScore({ ...base, distanceM: 100, overspeedEvents: 1 })).toBe(92)
  })
})
