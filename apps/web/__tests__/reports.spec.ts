import { describe, expect, it } from 'vitest'

import { cellValue, COLUMNS, deviceLabel, pdfSafe, REPORT_TYPES, toCsv, toPdfTable, unitColumns } from '../src/lib/reports.js'

describe('E06-2 toCsv', () => {
  const cols = COLUMNS.mileage // day, deviceId, trips, distanceM

  it('emits a header row even with no data', () => {
    expect(toCsv(cols, [])).toBe('day,deviceId,trips,distanceM')
  })

  it('serializes rows in column order with CRLF line endings', () => {
    const csv = toCsv(cols, [{ day: '2026-07-09', deviceId: '42', trips: 3, distanceM: 12000 }])
    expect(csv).toBe('day,deviceId,trips,distanceM\r\n2026-07-09,42,3,12000')
  })

  it('quotes fields containing commas, quotes, or newlines (RFC-4180)', () => {
    const csv = toCsv([{ key: 'x', label: 'x' }], [{ x: 'a,b' }, { x: 'say "hi"' }, { x: 'line1\nline2' }])
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"say ""hi"""')
    expect(csv).toContain('"line1\nline2"')
  })

  it('renders null/undefined as empty cells', () => {
    const csv = toCsv([{ key: 'maxSpeedKmh', label: 'm' }], [{ maxSpeedKmh: null }, {}])
    expect(csv).toBe('maxSpeedKmh\r\n\r\n')
  })

  it('every report type has a column layout', () => {
    for (const t of REPORT_TYPES) expect(COLUMNS[t].length).toBeGreaterThan(0)
  })
})

describe('unitColumns (display-pref unit conversion)', () => {
  const metric = { distance: 'km', speed: 'kmh' } as const
  const imperial = { distance: 'mi', speed: 'mph' } as const

  it('metric: distanceM renders as km with a unit-suffixed header; speeds stay km/h', () => {
    const csv = toCsv(unitColumns(COLUMNS.mileage, metric), [{ day: '2026-07-09', deviceId: '42', trips: 3, distanceM: 12340 }])
    expect(csv).toBe('day,deviceId,trips,distanceKm\r\n2026-07-09,42,3,12.3')
    const over = toCsv(unitColumns(COLUMNS.overspeed, metric), [{ day: 'd', deviceId: '42', count: 1, maxSpeedKmh: 97 }])
    expect(over).toContain('maxSpeedKmh')
    expect(over).toContain('97')
  })

  it('imperial: distance converts to mi and speed to mph, headers say so', () => {
    const csv = toCsv(unitColumns(COLUMNS.mileage, imperial), [{ day: '2026-07-09', deviceId: '42', trips: 3, distanceM: 160934.4 }])
    expect(csv).toBe('day,deviceId,trips,distanceMi\r\n2026-07-09,42,3,100')
    const over = toCsv(unitColumns(COLUMNS.overspeed, imperial), [{ day: 'd', deviceId: '42', count: 1, maxSpeedKmh: 97 }])
    expect(over).toContain('maxSpeedMph')
    expect(over.endsWith('60')).toBe(true) // 97 km/h → 60 mph
  })

  it("the trips report's maxSpeed column converts too, and the PDF matrix matches the CSV", () => {
    const cols = unitColumns(COLUMNS.trips, imperial)
    const row = { day: 'd', deviceId: '42', startTime: 's', endTime: 'e', distanceM: 1609.344, maxSpeed: 80.4672, idleS: 5 }
    const t = toPdfTable(cols, [row])
    expect(t.head[0]).toContain('distanceMi')
    expect(t.head[0]).toContain('maxSpeedMph')
    expect(t.body[0]).toContain('1') // 1609.344 m → 1 mi
    expect(t.body[0]).toContain('50') // 80.4672 km/h → 50 mph
  })

  it('non-numeric cells pass through unconverted and label→i18n keys stay in sync', () => {
    const cols = unitColumns(COLUMNS.mileage, imperial)
    expect(toCsv(cols, [{ day: 'd', deviceId: '42', trips: 1, distanceM: null }])).toContain('distanceMi\r\nd,42,1,')
    const dist = cols.find((c) => c.key === 'distanceM')!
    expect(dist.label).toBe('distanceMi') // reports.col.distanceMi exists in all 4 catalogs
  })
})

describe('toPdfTable (ADR-025)', () => {
  it('builds a head row from column keys + a body matrix, stringifying cells', () => {
    const cols = [{ key: 'day', label: 'day' }, { key: 'distanceM', label: 'distanceM' }]
    const t = toPdfTable(cols, [{ day: '2026-07-09', distanceM: 12000 }, { day: '2026-07-10', distanceM: null }])
    expect(t.head).toEqual([['day', 'distanceM']])
    expect(t.body).toEqual([['2026-07-09', '12000'], ['2026-07-10', '']]) // null → '', number → string
  })
})

describe('localized export headers (founder-flagged PDF/CSV header bug)', () => {
  const cols = COLUMNS.mileage // day, deviceId, trips, distanceM
  const headers = ['Diena', 'Įrenginys', 'Kelionės', 'Atstumas (m)']

  it('toCsv uses the injected localized headers instead of the raw slugs', () => {
    const csv = toCsv(cols, [{ day: 'd', deviceId: '42', trips: 1, distanceM: 10 }], headers)
    expect(csv.split('\r\n')[0]).toBe('Diena,Įrenginys,Kelionės,Atstumas (m)')
  })

  it('toPdfTable uses the injected localized headers', () => {
    const t = toPdfTable(cols, [], headers)
    expect(t.head).toEqual([headers])
  })

  it('omitted headers keep the legacy csvKey/key slugs (back-compat)', () => {
    expect(toCsv(cols, []).split('\r\n')[0]).toBe('day,deviceId,trips,distanceM')
  })
})

describe('device column shows the vehicle name, not the raw id', () => {
  it('deviceLabel prefers name, appends plate, falls back to the id defensively', () => {
    expect(deviceLabel({ deviceId: '42', deviceName: 'Van 1', devicePlate: 'ABC123' })).toBe('Van 1 (ABC123)')
    expect(deviceLabel({ deviceId: '42', deviceName: 'Van 1' })).toBe('Van 1')
    expect(deviceLabel({ deviceId: '42' })).toBe('42') // server hasn't joined the name yet
    expect(deviceLabel({ deviceId: 42 })).toBe(42)
  })

  it("the report's deviceId column renders the resolved label in the table/CSV/PDF", () => {
    const col = COLUMNS.mileage[1]! // deviceId
    expect(cellValue(col, { deviceId: '42', deviceName: 'Truck 7' })).toBe('Truck 7')
    const csv = toCsv(COLUMNS.mileage, [{ day: 'd', deviceId: '42', deviceName: 'Truck 7', trips: 1, distanceM: 0 }])
    expect(csv).toContain('Truck 7')
  })
})

describe('engine-hours report renders hours, not raw seconds', () => {
  it('converts the seconds column to hours (1dp) under an (h) header', () => {
    const col = COLUMNS.engine_hours[2]! // seconds → hours
    expect(col.label).toBe('hoursH')
    expect(cellValue(col, { seconds: 28800 })).toBe(8) // 8 h
    expect(cellValue(col, { seconds: 3600 * 1.5 })).toBe(1.5)
  })
})

describe('pdfSafe (jsPDF WinAnsi fallback)', () => {
  it('transliterates LT/PL Latin-Extended letters, leaves WinAnsi (umlauts) untouched', () => {
    expect(pdfSafe('Kelionės')).toBe('Keliones')
    expect(pdfSafe('Grcio viršijimas'.replace('Grcio', 'Greičio'))).toBe('Greicio virsijimas')
    expect(pdfSafe('Prędkość')).toBe('Predkosc')
    expect(pdfSafe('Motorstunden Gerät ö ü ß')).toBe('Motorstunden Gerät ö ü ß')
  })
})
