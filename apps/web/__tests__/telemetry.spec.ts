import { describe, expect, it } from 'vitest'

import { drawable, hasTelemetry, highlightRows, pointAt, telemetryRows, type TrackPoint } from '../src/lib/telemetry'

/**
 * The parameters list and the 24-hour track.
 *
 * The rule under all of it: nothing appears that the device did not send. There is no fixed field
 * list because there is no fixed field list — an FTC887 reports eleven elements, an FMC650 reports
 * hundreds, and which ones arrive is a fact about that vehicle.
 */
describe('telemetryRows', () => {
  it('shows exactly what the device sent, and nothing else', () => {
    const rows = telemetryRows({ 'GNSS Status': 2, 'External Voltage': 12004, 'Sleep Mode': 0 })
    expect(rows.map((r) => r.label)).toEqual(['External Voltage', 'GNSS Status', 'Sleep Mode'])
    expect(rows.map((r) => r.value)).toEqual(['12004', '2', '0'])
  })

  it('an undocumented id is labelled as one rather than hidden', () => {
    // `io_<id>` means the pipeline could not name the element from this model's dictionary: either
    // its wiki page is incomplete, or the name was ambiguous within the table. Both are findings.
    const rows = telemetryRows({ io_1234: 7 })
    expect(rows[0]).toMatchObject({ label: 'AVL 1234', value: '7', documented: false })
  })

  it('named parameters lead, then the raw ids, each naturally ordered', () => {
    const rows = telemetryRows({ io_20: 1, io_3: 1, Zulu: 1, Alpha: 1 })
    expect(rows.map((r) => r.label)).toEqual(['Alpha', 'Zulu', 'AVL 3', 'AVL 20'])
  })

  it('renders every JSON shape jsonb can hold — never "[object Object]"', () => {
    const rows = telemetryRows({ a: true, b: false, c: null, d: 'text', e: { nested: 1 }, f: [1, 2] })
    const by = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(by).toEqual({ a: '1', b: '0', c: '—', d: 'text', e: '{"nested":1}', f: '[1,2]' })
  })

  it('an empty attrs map is an empty list, not a crash', () => {
    expect(telemetryRows({})).toEqual([])
  })
})

describe('hasTelemetry', () => {
  it('a device that has never reported is distinguishable from one we have not asked about', () => {
    expect(hasTelemetry(undefined)).toBe(false)
    expect(hasTelemetry({ empty: true })).toBe(false)
    expect(hasTelemetry({ attrs: {}, fixValid: true } as never)).toBe(true)
  })
})

const pt = (iso: string, fixValid = true): TrackPoint =>
  ({ fixTime: iso, lat: 54.7, lon: 25.3, speed: 0, course: 0, ignition: null, fixValid })

describe('the 24-hour track', () => {
  it('an invalid fix is never drawable — invariant I6, on the read side', () => {
    // A tracker with no fix reports lat/lon 0/0. Drawing those put a vehicle in the Gulf of Guinea
    // once already; the track must not repeat it.
    const points = [pt('2026-08-18T10:00:00Z'), pt('2026-08-18T11:00:00Z', false)]
    expect(drawable(points).map((p) => p.fixTime)).toEqual(['2026-08-18T10:00:00Z'])
  })

  it('…but invalid fixes are KEPT in the track itself', () => {
    // "The tracker was reporting, it just could not see the sky" and "the tracker said nothing"
    // are different facts, and filtering at fetch time would make them indistinguishable. The
    // assertion is on the SCRUBBER's answer, not on the array literal the test just wrote.
    const points = [pt('2026-08-18T10:00:00Z'), pt('2026-08-18T11:00:00Z', false)]
    expect(pointAt(points, Date.parse('2026-08-18T11:30:00Z'))?.fixValid).toBe(false)
    expect(drawable(points)).toHaveLength(1)
  })

  it('one unparseable timestamp does not truncate the scan', () => {
    // `break`ing on NaN <= at silently cut the track at the bad row: a 13:00 scrub returned the
    // 10:00 point and every later moment froze there.
    const points = [pt('2026-08-18T10:00:00Z'), pt('not-a-date'), pt('2026-08-18T12:00:00Z')]
    expect(pointAt(points, Date.parse('2026-08-18T13:00:00Z'))?.fixTime).toBe('2026-08-18T12:00:00Z')
  })

  it('the scrubber shows the newest point AT OR BEFORE the moment, not the nearest', () => {
    // A track is a sequence of states: at 10:59 the vehicle was where it last reported, not where
    // it happens to report next.
    const points = [pt('2026-08-18T10:00:00Z'), pt('2026-08-18T11:00:00Z')]
    expect(pointAt(points, Date.parse('2026-08-18T10:59:00Z'))?.fixTime).toBe('2026-08-18T10:00:00Z')
    expect(pointAt(points, Date.parse('2026-08-18T11:00:00Z'))?.fixTime).toBe('2026-08-18T11:00:00Z')
  })

  it('before the first point there is nothing to show, rather than the first point', () => {
    const points = [pt('2026-08-18T10:00:00Z')]
    expect(pointAt(points, Date.parse('2026-08-18T09:00:00Z'))).toBeUndefined()
    expect(pointAt([], Date.now())).toBeUndefined()
  })
})

describe('highlightRows', () => {
  it('promotes only what the device actually sent, in a fixed reading order', () => {
    const rows = highlightRows({ 'External Voltage': 12004, 'GSM Signal': 4, Odd: 1 })
    expect(rows.map((r) => r.label)).toEqual(['GSM Signal', 'External Voltage'])
  })

  it('draws a bar only where the scale is documented', () => {
    // GSM signal is 1–5 and battery level is a percentage (FMB AVL 21 / 113), so both are a
    // proportion of something. External voltage is millivolts with no model-independent maximum —
    // inventing one would make the bar a claim about the vehicle.
    const rows = highlightRows({ 'GSM Signal': 5, 'Battery Level': 50, 'External Voltage': 12004 })
    const by = Object.fromEntries(rows.map((r) => [r.key, r.pct]))
    expect(by).toEqual({ 'GSM Signal': 1, 'Battery Level': 0.5, 'External Voltage': null })
  })

  it('a value outside the documented range gets no bar rather than a clamped lie', () => {
    // AVL 84 reports fuel in litres on some CAN adapters; 120 is not "120 %".
    expect(highlightRows({ 'Fuel Level': 120 })[0]).toMatchObject({ value: '120', pct: null })
  })

  it('a low level reads as low — the tone carries it, not a second row of text', () => {
    expect(highlightRows({ 'Fuel Level': 8 })[0]?.tone).toBe('danger')
    expect(highlightRows({ 'Fuel Level': 30 })[0]?.tone).toBe('warn')
    expect(highlightRows({ 'Fuel Level': 80 })[0]?.tone).toBe('accent')
  })

  it('matches the dictionary name whatever case it arrives in', () => {
    expect(highlightRows({ 'gsm signal': 3 }).map((r) => r.label)).toEqual(['gsm signal'])
  })

  it('a device reporting none of them yields no section at all', () => {
    expect(highlightRows({ 'Axis X': 12 })).toEqual([])
  })
})
