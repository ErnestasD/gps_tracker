import { describe, expect, it } from 'vitest'

import { maintenanceDue } from '../src/entities.js'

const NOW = Date.parse('2026-07-14T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

describe('V2 maintenanceDue', () => {
  it('km-based: overdue when past the interval, due_soon within 500 km, else ok', () => {
    // serviced at 10000 km, interval 15000 → due at 25000
    const base = { intervalKm: 15000, intervalDays: null, lastServiceOdoKm: 10000, lastServiceAt: null }
    expect(maintenanceDue(base, 26000, NOW)).toMatchObject({ kmRemaining: -1000, status: 'overdue' })
    expect(maintenanceDue(base, 24800, NOW)).toMatchObject({ kmRemaining: 200, status: 'due_soon' })
    expect(maintenanceDue(base, 20000, NOW)).toMatchObject({ kmRemaining: 5000, status: 'ok' })
  })

  it('day-based: overdue past the interval, due_soon within 14 days, else ok', () => {
    const base = { intervalKm: null, intervalDays: 30, lastServiceOdoKm: null, lastServiceAt: daysAgo(40) }
    expect(maintenanceDue(base, null, NOW)).toMatchObject({ daysRemaining: -10, status: 'overdue' })
    expect(maintenanceDue({ ...base, lastServiceAt: daysAgo(20) }, null, NOW)).toMatchObject({ daysRemaining: 10, status: 'due_soon' })
    expect(maintenanceDue({ ...base, lastServiceAt: daysAgo(5) }, null, NOW)).toMatchObject({ daysRemaining: 25, status: 'ok' })
  })

  it('takes the WORST of km and days (either overdue → overdue)', () => {
    const item = { intervalKm: 15000, intervalDays: 30, lastServiceOdoKm: 10000, lastServiceAt: daysAgo(5) }
    // days ok (25 left) but km overdue → overdue
    expect(maintenanceDue(item, 26000, NOW).status).toBe('overdue')
  })

  it("status='unknown' when nothing is computable (no interval or no baseline / no odometer)", () => {
    expect(maintenanceDue({ intervalKm: 15000, intervalDays: null, lastServiceOdoKm: 10000, lastServiceAt: null }, null, NOW))
      .toEqual({ kmRemaining: null, daysRemaining: null, status: 'unknown' }) // km interval but no current odometer
    expect(maintenanceDue({ intervalKm: null, intervalDays: null, lastServiceOdoKm: null, lastServiceAt: null }, 5000, NOW).status).toBe('unknown')
    expect(maintenanceDue({ intervalKm: 15000, intervalDays: null, lastServiceOdoKm: null, lastServiceAt: null }, 5000, NOW).status).toBe('unknown') // no baseline odo
  })
})
