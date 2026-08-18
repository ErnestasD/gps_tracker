import { describe, expect, it } from 'vitest'

import { documentDue, maintenanceDue, predictKmDueDate } from '../src/entities.js'

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
      .toEqual({ kmRemaining: null, daysRemaining: null, engineHRemaining: null, status: 'unknown' }) // km interval but no current odometer
    expect(maintenanceDue({ intervalKm: null, intervalDays: null, lastServiceOdoKm: null, lastServiceAt: null }, 5000, NOW).status).toBe('unknown')
    expect(maintenanceDue({ intervalKm: 15000, intervalDays: null, lastServiceOdoKm: null, lastServiceAt: null }, 5000, NOW).status).toBe('unknown') // no baseline odo
  })
})

describe('FLEET-1 engine-hour due', () => {
  const base = { intervalKm: null, intervalDays: null, intervalEngineH: 250, lastServiceOdoKm: null, lastServiceAt: null, lastServiceEngineH: 1000 }
  it('overdue past the interval, due_soon within 50 h, else ok', () => {
    expect(maintenanceDue(base, null, NOW, 1260)).toMatchObject({ engineHRemaining: -10, status: 'overdue' })
    expect(maintenanceDue(base, null, NOW, 1220)).toMatchObject({ engineHRemaining: 30, status: 'due_soon' })
    expect(maintenanceDue(base, null, NOW, 1100)).toMatchObject({ engineHRemaining: 150, status: 'ok' })
  })
  it('unknown without current engine hours or baseline', () => {
    expect(maintenanceDue(base, null, NOW, null).status).toBe('unknown')
    expect(maintenanceDue({ ...base, lastServiceEngineH: null }, null, NOW, 1200).status).toBe('unknown')
  })
  it('the worst dimension wins across km/days/hours', () => {
    const mixed = { intervalKm: 15000, intervalDays: null, intervalEngineH: 250, lastServiceOdoKm: 10000, lastServiceAt: null, lastServiceEngineH: 1000 }
    // km fine (5000 left) but hours overdue → overdue
    expect(maintenanceDue(mixed, 20000, NOW, 1300).status).toBe('overdue')
  })
})

describe('FLEET-1 documentDue', () => {
  it('valid THROUGH the stated day; due_soon within 30 days; overdue after', () => {
    expect(documentDue('2026-07-14', NOW).status).toBe('due_soon') // expires today → 0 days left
    expect(documentDue('2026-08-13', NOW)).toMatchObject({ daysRemaining: 30, status: 'due_soon' })
    expect(documentDue('2026-08-14', NOW).status).toBe('ok')
    expect(documentDue('2026-07-13', NOW)).toMatchObject({ daysRemaining: -1, status: 'overdue' })
  })
})

describe('FLEET-1 predictKmDueDate', () => {
  it('divides remaining km by the daily average', () => {
    expect(predictKmDueDate(1200, 100, NOW)).toBe('2026-07-26')
  })
  it('null when overdue, no average, zero average or absurd horizon', () => {
    expect(predictKmDueDate(-5, 100, NOW)).toBeNull()
    expect(predictKmDueDate(1200, null, NOW)).toBeNull()
    expect(predictKmDueDate(1200, 0, NOW)).toBeNull()
    expect(predictKmDueDate(10_000_000, 1, NOW)).toBeNull()
  })
})
