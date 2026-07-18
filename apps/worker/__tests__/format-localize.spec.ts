import { describe, expect, it } from 'vitest'

import { formatInZone, formatWithZone, metersToKm, safeZone, secondsToHours } from '../src/format/localize.js'
import { renderReportTable, reportTitle } from '../src/format/report.js'

describe('format/localize unit conversion', () => {
  it('meters → km at one decimal', () => {
    expect(metersToKm(15234)).toBe('15.2')
    expect(metersToKm(0)).toBe('0.0')
    expect(metersToKm(999)).toBe('1.0')
  })
  it('seconds → hours at one decimal', () => {
    expect(secondsToHours(3600)).toBe('1.0')
    expect(secondsToHours(0)).toBe('0.0')
    expect(secondsToHours(5400)).toBe('1.5')
  })
})

describe('format/localize timezone (rule 7)', () => {
  const utcMidnight = new Date('2026-07-09T00:00:00Z')
  it('renders a UTC instant in the account zone (not UTC ISO)', () => {
    // 00:00 UTC on 2026-07-09 → 03:00 in Europe/Vilnius (UTC+3 in July, DST)
    expect(formatInZone(utcMidnight, 'Europe/Vilnius')).toBe('2026-07-09 03:00')
    expect(formatInZone(utcMidnight, 'UTC')).toBe('2026-07-09 00:00')
  })
  it('crosses the day boundary correctly for a west-of-UTC zone', () => {
    // 00:00 UTC → 20:00 the PREVIOUS day in New York (UTC-4 in July)
    expect(formatInZone(utcMidnight, 'America/New_York')).toBe('2026-07-08 20:00')
  })
  it('formatWithZone appends the zone name', () => {
    expect(formatWithZone(utcMidnight, 'Europe/Vilnius')).toBe('2026-07-09 03:00 (Europe/Vilnius)')
  })
  it('falls back to UTC for a garbage/absent zone (never throws)', () => {
    expect(safeZone('Not/AZone')).toBe('UTC')
    expect(safeZone(undefined)).toBe('UTC')
    expect(safeZone(null)).toBe('UTC')
    expect(formatInZone(utcMidnight, 'Not/AZone')).toBe('2026-07-09 00:00')
  })
})

describe('format/report labels + table', () => {
  it('maps report types to human titles', () => {
    expect(reportTitle('mileage')).toBe('Mileage')
    expect(reportTitle('engine_hours')).toBe('Engine hours')
    expect(reportTitle('unknown_kind')).toBe('unknown_kind')
  })

  it('renders a labelled table with converted units and device name (no raw keys/meters)', () => {
    const table = renderReportTable('mileage', [{ day: '2026-07-14', deviceId: '5', deviceName: 'Van 1', devicePlate: 'ABC', trips: 3, distanceM: 15234 }], 'UTC')
    expect(table).toContain('Distance (km)')
    expect(table).not.toContain('distanceM')
    expect(table).toContain('15.2')
    expect(table).toContain('Van 1')
  })

  it('falls back to the plate, then the raw id, when the name is absent', () => {
    expect(renderReportTable('mileage', [{ day: 'd', deviceId: '9', deviceName: null, devicePlate: 'XYZ-9', trips: 1, distanceM: 0 }], 'UTC')).toContain('XYZ-9')
    expect(renderReportTable('mileage', [{ day: 'd', deviceId: '9', deviceName: null, devicePlate: null, trips: 1, distanceM: 0 }], 'UTC')).toContain('9')
  })

  it('converts idle seconds to hours in a stops report', () => {
    expect(renderReportTable('stops', [{ day: 'd', deviceId: '5', deviceName: 'Van', devicePlate: null, trips: 2, idleS: 5400 }], 'UTC')).toContain('1.5')
  })

  it('formats trip timestamps in the account zone', () => {
    const table = renderReportTable('trips', [{ id: 't', deviceId: '5', deviceName: 'Van', devicePlate: null, day: 'd', startTime: '2026-07-14T09:30:00.000Z', endTime: null, distanceM: 1000, distanceSource: 'gps', maxSpeed: 50, idleS: 0 }], 'Europe/Vilnius')
    expect(table).toContain('2026-07-14 12:30') // 09:30 UTC + 3h
    expect(table).toContain('—') // null endTime rendered as a dash, not 'null'
  })

  it('empty rows produce an explicit no-data marker', () => {
    expect(renderReportTable('mileage', [], 'UTC')).toBe('(no data in this period)')
  })
})
