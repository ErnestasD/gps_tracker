import { describe, expect, it } from 'vitest'

import { drawable, hasTelemetry, highlightRows, placeAt, pointAt, telemetryRows, trackTimes, type TrackPoint } from '../src/lib/telemetry'

/**
 * The parameters list and the 24-hour track.
 *
 * The rule under all of it: nothing appears that the device did not send. There is no fixed field
 * list because there is no fixed field list — an FTC887 reports eleven elements, an FMC650 reports
 * hundreds, and which ones arrive is a fact about that vehicle.
 */
describe('telemetryRows', () => {
  it('shows what the device sent — in human units where the NAME pins the unit down', () => {
    // External Voltage is millivolts on every Teltonika table, so "12.0 V" adds no claim the
    // raw number didn't already make (founder 2026-08-20: 12787 where an operator reads volts
    // is noise). Unnamed values stay exactly as sent.
    const rows = telemetryRows({ 'GNSS Status': 2, 'External Voltage': 12004, 'Sleep Mode': 0 })
    expect(rows.map((r) => r.label)).toEqual(['External Voltage', 'GNSS Status', 'Sleep Mode'])
    expect(rows.map((r) => r.value)).toEqual(['12.0 V', '2', '0'])
  })

  it('the mileage family renders as kilometres', () => {
    expect(telemetryRows({ 'Total Mileage': 15850 })[0]?.value).toBe('15.85 km')
  })

  it('an io_<id> row stays raw — its unit is unknown by definition', () => {
    expect(telemetryRows({ io_66: 12004 })[0]?.value).toBe('12004')
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
  ({ fixTime: iso, lat: 54.7, lon: 25.3, speed: 0, course: 0, ignition: null, movement: null, fixValid })

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

/**
 * Where to put the CAMERA at a moment — the I6-critical half of the scrubber.
 *
 * `undefined` here means "hold where you are". It used to be conflated with "back to live", and the
 * map then flew to the vehicle's present position while the readout named a moment 24 hours ago.
 */
describe('placeAt', () => {
  const at = (iso: string) => Date.parse(iso)

  it('a moment before the first valid fix has no answer — and must not be one', () => {
    const points = [pt('2026-08-19T10:00:00Z')]
    expect(placeAt(points, at('2026-08-19T09:00:00Z'))).toBeUndefined()
    expect(placeAt([], Date.now())).toBeUndefined()
  })

  it('the window start is one such moment, which is why -24 h kept jumping to live', () => {
    // getTrack asks for [now-24h, now]; the earliest ROW is always later than the window's start,
    // so the leftmost slider position never resolves to a point.
    const to = at('2026-08-19T12:00:00Z')
    const points = [pt('2026-08-19T02:00:00Z')]
    expect(placeAt(points, to - 24 * 3_600_000)).toBeUndefined()
  })

  it('holds at the last VALID fix across a no-fix stretch (I6)', () => {
    const points = [pt('2026-08-19T10:00:00Z'), pt('2026-08-19T11:00:00Z', false)]
    const found = placeAt(points, at('2026-08-19T11:30:00Z'))
    expect(found?.fixTime).toBe('2026-08-19T10:00:00Z')
  })

  it('never returns a point from the future of the moment asked about', () => {
    const points = [pt('2026-08-19T10:00:00Z'), pt('2026-08-19T12:00:00Z')]
    expect(placeAt(points, at('2026-08-19T11:00:00Z'))?.fixTime).toBe('2026-08-19T10:00:00Z')
  })

  it('one unparseable timestamp does not truncate the scan', () => {
    const points = [pt('2026-08-19T10:00:00Z'), pt('not-a-date'), pt('2026-08-19T12:00:00Z')]
    expect(placeAt(points, at('2026-08-19T13:00:00Z'))?.fixTime).toBe('2026-08-19T12:00:00Z')
  })
})

describe('pre-parsed timestamps', () => {
  it('the fast path answers exactly what the slow one does, bad rows included', () => {
    // A drag runs two scans per step over up to 10 000 points; parsing once is the whole point, and
    // a fast path that disagrees with the slow one is worse than no fast path.
    const points = [pt('2026-08-19T10:00:00Z'), pt('not-a-date'), pt('2026-08-19T11:00:00Z', false), pt('2026-08-19T12:00:00Z')]
    const times = trackTimes(points)
    expect(times[1]).toBeNaN()
    for (const at of ['2026-08-19T09:00:00Z', '2026-08-19T10:30:00Z', '2026-08-19T11:30:00Z', '2026-08-19T13:00:00Z']) {
      const ms = Date.parse(at)
      expect(pointAt(points, ms, times)).toBe(pointAt(points, ms))
      expect(placeAt(points, ms, times)).toBe(placeAt(points, ms))
    }
  })
})

/**
 * Door Status is a bitmask, and the founder reads open/closed — not 256.
 * https://wiki.teltonika-gps.com/view/FMC150_Teltonika_Data_Sending_Parameters_ID
 */
describe('door status', () => {
  const door = { name: 'Door Status', max: '16128', group: 'LVCAN200, ALLCAN300, CANCONTROL' }
  const parts = (v: number): Record<string, boolean> => {
    const out: Record<string, boolean> = {}
    for (const r of telemetryRows({ 'Door Status': v }, { 'Door Status': door })) {
      if (r.binary !== undefined) out[r.binary.labelKey] = r.binary.open
    }
    return out
  }

  it('one element becomes doors, boot and bonnet — each its own state', () => {
    // 256 = 0x100, the driver's door: what the founder measured on LDZ246 (2026-09-04)
    expect(parts(256)).toEqual({ doors: true, trunk: false, hood: false })
    expect(parts(0)).toEqual({ doors: false, trunk: false, hood: false })
  })

  it('any of the four doors reads as open, and the boot never does', () => {
    for (const bit of [0x100, 0x200, 0x400, 0x800]) expect(parts(bit).doors).toBe(true)
    // an open boot must not raise a doors-open alert — that is why it is a separate row
    expect(parts(0x2000)).toEqual({ doors: false, trunk: true, hood: false })
    expect(parts(0x1000)).toEqual({ doors: false, trunk: false, hood: true })
    expect(parts(16128)).toEqual({ doors: true, trunk: true, hood: true }) // 0x3F00, everything open
  })

  it('an element merely NAMED "Door Status" is left as a number', () => {
    // fmb640 id 10355 is a 1-byte Reefer IO element with max 255 — the same name, none of these
    // bits. Decoding it with this layout would invent a reading, so the max cell is the gate.
    const reefer = { name: 'Door Status', max: '255', group: 'Reefer IO' }
    const rows = telemetryRows({ 'Door Status': 1 }, { 'Door Status': reefer })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.binary).toBeUndefined()
    expect(rows[0]?.value).toBe('1')
  })
})

describe('vehicle before device', () => {
  it("what the car reports leads, ordered by Teltonika's own parameter group", () => {
    const rows = telemetryRows(
      { 'Battery Voltage': 3900, 'Fuel Level': 180, 'GSM Signal': 5, 'Engine RPM': 801 },
      {
        'Battery Voltage': { name: 'Battery Voltage', group: 'Permanent I/O elements' },
        'Fuel Level': { name: 'Fuel Level', group: 'CAN Chip', units: 'l', multiplier: 0.1 },
        'GSM Signal': { name: 'GSM Signal', group: 'Permanent I/O Elements' },
        'Engine RPM': { name: 'Engine RPM', group: 'OBD elements' },
      },
    )
    expect(rows.map((r) => r.section)).toEqual(['vehicle', 'vehicle', 'device', 'device'])
    // fuel is what the tab is opened for; it used to sit below Battery Voltage on name order alone
    expect(rows[0]?.label).toBe('Engine RPM')
    expect(rows[1]?.value).toBe('18.0 l')
  })

  it('a trailer fridge is not the vehicle, however its group is spelled', () => {
    // "Euroscan IO" and "Transcan IO" contain the letters "can" and are cargo equipment, not the bus
    for (const group of ['Euroscan IO', 'Transcan IO', 'Reefer IO', 'Bluetooth®Low Energy']) {
      expect(telemetryRows({ x: 1 }, { x: { name: 'x', group } })[0]?.section).toBe('device')
    }
    for (const group of ['CAN Chip', 'OBD elements', 'ALLCAN300', 'LV-CAN200 + DTC', 'TACHO', 'Manual CAN elements']) {
      expect(telemetryRows({ x: 1 }, { x: { name: 'x', group } })[0]?.section).toBe('vehicle')
    }
  })

  it('an element with no group stays with the tracker, where the list has always shown it', () => {
    expect(telemetryRows({ io_9999: 1 })[0]?.section).toBe('device')
  })
})
