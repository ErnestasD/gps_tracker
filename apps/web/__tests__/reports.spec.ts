import { describe, expect, it } from 'vitest'

import { COLUMNS, REPORT_TYPES, toCsv, toPdfTable } from '../src/lib/reports.js'

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

describe('toPdfTable (ADR-025)', () => {
  it('builds a head row from column keys + a body matrix, stringifying cells', () => {
    const cols = [{ key: 'day', label: 'day' }, { key: 'distanceM', label: 'distanceM' }]
    const t = toPdfTable(cols, [{ day: '2026-07-09', distanceM: 12000 }, { day: '2026-07-10', distanceM: null }])
    expect(t.head).toEqual([['day', 'distanceM']])
    expect(t.body).toEqual([['2026-07-09', '12000'], ['2026-07-10', '']]) // null → '', number → string
  })
})
