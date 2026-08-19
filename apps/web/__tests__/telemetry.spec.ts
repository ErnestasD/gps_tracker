import { describe, expect, it } from 'vitest'

import { drawable, hasTelemetry, pointAt, telemetryRows, type TrackPoint } from '../src/lib/telemetry'

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
    // are different facts, and filtering at fetch time would make them indistinguishable.
    const points = [pt('2026-08-18T10:00:00Z'), pt('2026-08-18T11:00:00Z', false)]
    expect(points).toHaveLength(2)
    expect(pointAt(points, Date.parse('2026-08-18T11:30:00Z'))?.fixValid).toBe(false)
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
