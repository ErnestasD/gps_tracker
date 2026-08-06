import { describe, expect, it } from 'vitest'

import { distanceM, formatInZone, formatWithZone, safeZone, secondsToHours, speedKmh, volumeL } from '../src/format/localize.js'
import { renderReportTable, renderReportTableHtml, reportTitle } from '../src/format/report.js'

const IMPERIAL = { speed: 'mph', distance: 'mi', volume: 'gal' } as const

describe('format/localize unit conversion', () => {
  it('meters → km at one decimal (metric default)', () => {
    expect(distanceM(15234)).toBe('15.2')
    expect(distanceM(0)).toBe('0.0')
    expect(distanceM(999)).toBe('1.0')
  })
  it('seconds → hours at one decimal', () => {
    expect(secondsToHours(3600)).toBe('1.0')
    expect(secondsToHours(0)).toBe('0.0')
    expect(secondsToHours(5400)).toBe('1.5')
  })
  it('converts to the account units when they are imperial', () => {
    // 1609.344 m is exactly one mile — the factor is shared with the web, so this pins both
    expect(distanceM(1609.344, IMPERIAL)).toBe('1.0')
    expect(distanceM(15234, IMPERIAL)).toBe('9.5')
    expect(speedKmh(96.56064, IMPERIAL)).toBe('60')
    expect(volumeL(3.785411784, IMPERIAL)).toBe('1.0')
  })
  it('speeds are whole numbers — a GPS speed has no meaningful tenth', () => {
    expect(speedKmh(95.4)).toBe('95')
    expect(speedKmh(95.6)).toBe('96')
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

describe('format/report in the account language + units (account-settings debt, closed)', () => {
  const row = { day: '2026-07-14', deviceId: '5', deviceName: 'Van 1', devicePlate: 'ABC', trips: 3, distanceM: 16093.44 }

  it('renders titles and column headers in the account language', () => {
    expect(reportTitle('mileage', 'lt')).toBe('Rida')
    expect(reportTitle('engine_hours', 'de')).toBe('Motorstunden')
    expect(reportTitle('stops', 'pl')).toBe('Postoje')
    const lt = renderReportTable('mileage', [row], 'UTC', { locale: 'lt' })
    expect(lt).toContain('Atstumas (km)')
    expect(lt).toContain('Kelionės')
    expect(lt).not.toContain('Distance')
  })

  it('puts the unit in the header and the converted value in the cell', () => {
    const t = renderReportTable('mileage', [row], 'UTC', { locale: 'lt', units: IMPERIAL })
    expect(t).toContain('Atstumas (mi)')
    expect(t).toContain('10.0') // 16093.44 m = exactly 10 miles
    expect(t).not.toContain('16.1')
  })

  it('localizes the hours label in idle/engine columns', () => {
    expect(renderReportTable('stops', [{ day: 'd', deviceId: '5', trips: 2, idleS: 5400 }], 'UTC', { locale: 'lt' })).toContain('Prastova (val.)')
    expect(renderReportTable('engine_hours', [{ day: 'd', deviceId: '5', seconds: 3600 }], 'UTC', { locale: 'de' })).toContain('Motor (Std.)')
    expect(renderReportTable('stops', [{ day: 'd', deviceId: '5', trips: 2, idleS: 5400 }], 'UTC', { locale: 'pl' })).toContain('Postój (godz.)')
  })

  it('speed columns follow the speed unit, not the distance unit', () => {
    const t = renderReportTable('overspeed', [{ day: 'd', deviceId: '5', count: 2, maxSpeedKmh: 96.56064 }], 'UTC', { units: IMPERIAL })
    expect(t).toContain('Max speed (mph)')
    expect(t).toContain('60')
  })

  it('an unknown locale renders English rather than throwing (the column has no CHECK)', () => {
    expect(reportTitle('mileage', 'xx-YY')).toBe('Mileage')
    expect(renderReportTable('mileage', [], 'UTC', { locale: 'klingon' })).toBe('(no data in this period)')
  })

  it('the no-data marker is translated too', () => {
    expect(renderReportTable('mileage', [], 'UTC', { locale: 'lt' })).toBe('(šiuo laikotarpiu duomenų nėra)')
    expect(renderReportTableHtml('mileage', [], 'UTC', { locale: 'de' })).toContain('keine Daten')
  })

  it('an unparseable timestamp is a dash, not a throw', () => {
    // the plain-text renderer is NOT wrapped in a try/catch (the HTML one is), and it runs after
    // claimRun has burned the period — one bad row would lose that report permanently
    const rows = [{ deviceId: '5', deviceName: 'Van', startTime: 'not-a-date', endTime: '', distanceM: 0, maxSpeed: 0, idleS: 0 }]
    expect(() => renderReportTable('trips', rows, 'UTC')).not.toThrow()
    expect(renderReportTable('trips', rows, 'UTC')).toContain('—')
  })

  it('the HTML table carries the same localized headers, escaped', () => {
    const html = renderReportTableHtml('mileage', [{ ...row, deviceName: '<b>Van</b>' }], 'UTC', { locale: 'lt', units: IMPERIAL })
    expect(html).toContain('Atstumas (mi)')
    expect(html).toContain('&lt;b&gt;Van&lt;/b&gt;')
    expect(html).not.toContain('<b>Van</b>')
  })
})
