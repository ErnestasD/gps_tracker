import type { EventView } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { EVENT_KINDS, eventDetail, eventSeverity, eventSummary, eventSummaryT, eventTone, eventsQuery, localizedEventSummary, eventFacts, type EventRow } from '../src/lib/events.js'


const ev = (kind: string, payload: Record<string, unknown>): EventView => ({
  id: '1',
  deviceId: '42',
  ruleId: 'r1',
  kind,
  at: '2026-07-09T00:00:00.000Z',
  lat: null,
  lon: null,
  payload,
  endedAt: null, acknowledgedAt: null,
  createdAt: '2026-07-09T00:00:00.000Z',
})

describe('E05-6 eventsQuery', () => {
  it('drops empty filters and encodes the rest', () => {
    expect(eventsQuery({})).toBe('')
    expect(eventsQuery({ kind: '', deviceId: '' })).toBe('')
    const q = eventsQuery({ kind: 'panic', deviceId: '42', from: '2026-07-01T00:00:00Z', to: '2026-07-02T00:00:00Z', limit: 50, cursor: '99' })
    expect(q).toContain('kind=panic')
    expect(q).toContain('deviceId=42')
    expect(q).toContain('from=')
    expect(q).toContain('to=')
    expect(q).toContain('cursor=99')
    expect(q).toContain('limit=50')
    expect(q.startsWith('?')).toBe(true)
  })
})

describe('E05-6 eventSummary', () => {
  it('summarizes each kind, rounding numbers', () => {
    expect(eventSummary(ev('overspeed', { speedKmh: 95.4, limitKmh: 90 }))).toBe('95.4 km/h > 90')
    expect(eventSummary(ev('low_battery', { volts: 10.523, thresholdV: 11 }))).toBe('10.52 V < 11')
    expect(eventSummary(ev('ignition', { ignition: false }))).toBe('ignition off')
    expect(eventSummary(ev('din_change', { din1: true }))).toBe('DIN1 on')
    expect(eventSummary(ev('geofence', { name: 'Depot', transition: 'enter' }))).toBe('Depot · enter')
    expect(eventSummary(ev('device_offline', { offlineH: 27, thresholdH: 26 }))).toBe('offline 27 h (≥ 26 h)')
  })

  it('handles missing payload fields without throwing, and invents no unit', () => {
    // was '— km/h > —': a unit label attached to a value the device never sent, pinned here as if
    // it were the contract. A missing speed is '—', full stop.
    expect(eventSummary(ev('overspeed', {}))).toBe('— > —')
    expect(eventSummary(ev('panic', {}))).toBe('SOS triggered') // fixed one-liner, no payload needed
    expect(eventSummary(ev('power_cut', {}))).toBe('external power lost')
  })

  it('EVENT_KINDS includes geofence plus all engine + sweeper kinds', () => {
    expect(EVENT_KINDS).toContain('geofence')
    expect(EVENT_KINDS).toContain('device_offline')
    expect(EVENT_KINDS).toContain('fuel_theft') // worker emits it; must be filterable + webhook-subscribable
    expect(EVENT_KINDS).toHaveLength(9)
  })

  it('summarizes fuel_theft (pct and litres)', () => {
    expect(eventSummary(ev('fuel_theft', { unit: 'pct', drop: 22 }))).toBe('fuel dropped 22 %')
    expect(eventSummary(ev('fuel_theft', { unit: 'liters', drop: 18.5 }))).toBe('fuel dropped 18.5 L')
    expect(eventSummaryT(ev('fuel_theft', { unit: 'liters', drop: 18.5 }))).toEqual({ key: 'events.s.fuel_theft', params: { drop: '18.5', unit: 'L' } })
  })

  it('fuel_theft litres drop honors the volume-unit pref via fmtVolume', () => {
    // gallons account: the litre drop is converted + carries its own localized unit label
    expect(eventSummaryT(ev('fuel_theft', { unit: 'liters', drop: 18.5 }), { fmtVolume: (l) => `${(l / 3.785411784).toFixed(1)} gal` })).toEqual({
      key: 'events.s.fuel_theft_vol',
      params: { drop: '4.9 gal' },
    })
    // a percentage drop has no volume conversion — still the plain % key even with fmtVolume
    expect(eventSummaryT(ev('fuel_theft', { unit: 'pct', drop: 22 }), { fmtVolume: (l) => `${l} l` })).toEqual({
      key: 'events.s.fuel_theft',
      params: { drop: '22', unit: '%' },
    })
  })
})

describe('i18n eventSummaryT / localizedEventSummary', () => {
  it('maps every kind to an events.s.* key with rounded params', () => {
    // speed params carry their unit label (the events.s.overspeed key is unit-agnostic so
    // the value renders as km/h or mph per the display prefs)
    expect(eventSummaryT(ev('overspeed', { speedKmh: 95.4, limitKmh: 90 }))).toEqual({ key: 'events.s.overspeed', params: { speed: '95.4 km/h', limit: '90 km/h' } })
    expect(eventSummaryT(ev('overspeed', { speedKmh: 95.4, limitKmh: 90 }), { fmtSpeed: (kmh) => `${Math.round(kmh / 1.609344)} mph` })).toEqual({
      key: 'events.s.overspeed',
      params: { speed: '59 mph', limit: '56 mph' },
    })
    expect(eventSummaryT(ev('low_battery', { volts: 10.523, thresholdV: 11 }))).toEqual({ key: 'events.s.low_battery', params: { volts: '10.52', threshold: '11' } })
    expect(eventSummaryT(ev('ignition', { ignition: true }))!.key).toBe('events.s.ignition_on')
    expect(eventSummaryT(ev('ignition', { ignition: false }))!.key).toBe('events.s.ignition_off')
    expect(eventSummaryT(ev('din_change', { din1: true }))!.key).toBe('events.s.din_on')
    expect(eventSummaryT(ev('geofence', { name: 'Depot', transition: 'enter' }))).toEqual({ key: 'events.s.geofence_enter', params: { name: 'Depot', transition: 'enter' } })
    expect(eventSummaryT(ev('geofence', { name: 'Depot' }))!.key).toBe('events.s.geofence') // unknown transition → generic key
    expect(eventSummaryT(ev('device_offline', { offlineH: 27, thresholdH: 26 }))).toEqual({ key: 'events.s.device_offline', params: { hours: '27', threshold: '26' } })
    expect(eventSummaryT(ev('panic', {}))!.key).toBe('events.s.panic')
    expect(eventSummaryT(ev('power_cut', {}))!.key).toBe('events.s.power_cut')
    expect(eventSummaryT(ev('mystery_kind', {}))).toBeNull()
  })

  it('localizedEventSummary renders through t and falls back to the pure eventSummary', () => {
    const calls: [string, Record<string, unknown> | undefined][] = []
    const t = (key: string, options?: Record<string, unknown>) => {
      calls.push([key, options])
      return `T(${key})`
    }
    expect(localizedEventSummary(t, ev('panic', {}))).toBe('T(events.s.panic)')
    // the pure English summary rides along as i18next's defaultValue
    expect(calls[0]![1]!['defaultValue']).toBe('SOS triggered')
    // unknown kinds skip t entirely and return the pure summary ('' today)
    expect(localizedEventSummary(t, ev('mystery_kind', {}))).toBe(eventSummary(ev('mystery_kind', {})))
  })
})

/**
 * Severity has exactly one source.
 *
 * A second table put fuel theft in red on the map and grey on the events page, out of the same
 * record — so this pins that the tone is a view of `eventSeverity` and never a table of its own.
 */
  it('maps kinds to the shared severity buckets', () => {
    expect(eventSeverity('panic')).toBe('critical')
    expect(eventSeverity('power_cut')).toBe('critical')
    expect(eventSeverity('overspeed')).toBe('warning')
    expect(eventSeverity('device_offline')).toBe('warning')
    expect(eventSeverity('geofence')).toBe('info')
    expect(eventSeverity('ignition')).toBe('info')
  })

describe('eventTone', () => {
  it('is a thin view over eventSeverity, for every kind the pipeline emits', () => {
    for (const kind of EVENT_KINDS) {
      const expected = eventSeverity(kind) === 'critical' ? 'danger' : eventSeverity(kind) === 'warning' ? 'warn' : 'default'
      expect(eventTone(kind), kind).toBe(expected)
    }
  })

  it('a kind nobody has classified is neutral, never a guessed alarm', () => {
    expect(eventTone('something_new_from_the_pipeline')).toBe('default')
  })
})

describe('a summary never invents a unit', () => {
  it('an absent value carries no unit label', () => {
    // "— km/h > 56 mph" put two unit systems in one line, one of them attached to a value the
    // device never sent.
    const d = eventSummaryT(ev('overspeed', { limitKmh: 90 }), { fmtSpeed: (k) => `${k} mph` })
    expect(d?.params['speed']).toBe('—')
    expect(d?.params['limit']).toBe('90 mph')
  })
})

/**
 * What a row says BEYOND its own label.
 *
 * The rule this pins was wrong once already: keyed on whether the descriptor interpolated anything,
 * it hid `ignition` and `din_change` — the two kinds that carry their fact in the KEY rather than
 * in the params — so the map could not say whether the vehicle had started or stopped.
 */
describe('eventDetail', () => {
  const T = ((k: string, p?: Record<string, string>) => `${k}:${JSON.stringify(p ?? {})}`) as never

  const PAYLOADS: Record<string, Record<string, unknown>> = {
    overspeed: { speedKmh: 91, limitKmh: 90 },
    geofence: { name: 'STL bazė', transition: 'exit' },
    ignition: { ignition: true },
    din_change: { din1: true },
    power_cut: {},
    low_battery: { volts: 10.5, thresholdV: 11 },
    panic: {},
    device_offline: { offlineH: 27, thresholdH: 26 },
    fuel_theft: { drop: 20, unit: 'percent' },
  }

  it('says nothing extra only for the two kinds whose summary IS their label', () => {
    const silent = EVENT_KINDS.filter((k) => eventDetail(T, ev(k, PAYLOADS[k] ?? {})) === '')
    expect([...silent].sort()).toEqual(['panic', 'power_cut'])
  })

  it('ignition and din_change say WHICH way they went — the fact lives in the key', () => {
    expect(eventDetail(T, ev('ignition', { ignition: true }))).toContain('ignition_on')
    expect(eventDetail(T, ev('ignition', { ignition: false }))).toContain('ignition_off')
    expect(eventDetail(T, ev('din_change', { din1: true }))).toContain('din_on')
  })

  it('a summary of nothing but placeholders is not information', () => {
    // "Overspeed · — > —" is the absence of a payload wearing the shape of one
    expect(eventDetail(T, ev('overspeed', {}))).toBe('')
    expect(eventDetail(T, ev('geofence', {}))).toBe('')
  })

  it('every other kind carries its payload through', () => {
    expect(eventDetail(T, ev('overspeed', PAYLOADS['overspeed']!))).toContain('91')
    expect(eventDetail(T, ev('geofence', PAYLOADS['geofence']!))).toContain('STL bazė')
    expect(eventDetail(T, ev('device_offline', PAYLOADS['device_offline']!))).toContain('27')
  })
})

describe('eventFacts — the details panel, in parts', () => {
  const row = (kind: string, payload: Record<string, unknown>): EventRow =>
    ({ id: '1', deviceId: 'd1', kind, at: '2026-09-01T14:20:00Z', endedAt: null, lat: 54.5, lon: 25.2, payload }) as unknown as EventRow

  it('breaks an overspeed into speed, limit and the number nobody stored: how far over', () => {
    const f = eventFacts(row('overspeed', { rule: 'Greičio viršijimas 90', speedKmh: 105, limitKmh: 90 }))
    expect(f.map((x) => x.key)).toEqual(['events.f.speed', 'events.f.limit', 'events.f.over', 'events.f.rule'])
    expect(f[2]!.value).toContain('15')
    // the rule name was ONLY ever visible inside the raw JSON
    expect(f[3]!.value).toBe('Greičio viršijimas 90')
  })

  it('never leaves a label without a value — a lone heading reads as data that failed to load', () => {
    for (const [kind, payload] of [
      ['geofence', { name: 'Depot', transition: 'enter' }],
      ['ignition', { rule: 'r', ignition: true }],
      ['fuel_theft', { rule: 'r', unit: 'pct', baseline: 60, to: 48, drop: 12 }],
      ['device_offline', { rule: 'device_offline', offlineH: 7, thresholdH: 6, lastFixMs: 1_756_000_000_000 }],
    ] as const) {
      for (const f of eventFacts(row(kind, payload))) {
        expect(f.value !== '' || f.valueKey !== undefined, `${kind}/${f.key ?? f.rawLabel ?? ''}`).toBe(true)
      }
    }
  })

  it('leads with the DURATION, and keeps the peak the cooldown used to discard', () => {
    const e = { ...row('overspeed', { rule: 'r90', speedKmh: 95, limitKmh: 90, maxSpeedKmh: 155 }), endedAt: '2026-09-01T14:42:00Z' }
    const f = eventFacts(e)
    // "for how long" is the question five identical rows could never answer, so it comes first
    expect(f[0]!.key).toBe('events.f.duration')
    expect(f[0]!.value).toBe('22 min')
    expect(f.find((x) => x.key === 'events.f.peak')?.value).toContain('155')
    // …and the peak is not repeated as an unknown key
    expect(f.some((x) => x.rawLabel === 'maxSpeedKmh')).toBe(false)
  })

  it('shows no peak when the breach never got worse than its first moment', () => {
    const e = { ...row('overspeed', { rule: 'r', speedKmh: 100, limitKmh: 90, maxSpeedKmh: 100 }), endedAt: null }
    // a "peak" equal to the opening speed is noise: it tells the operator nothing they cannot see
    expect(eventFacts(e).some((x) => x.key === 'events.f.peak')).toBe(false)
  })

  it('lists a payload key it has never seen instead of hiding it', () => {
    // a new event kind must render as an untidy-but-complete list, never as a silently short one
    const f = eventFacts(row('overspeed', { rule: 'r', speedKmh: 100, limitKmh: 90, heading: 231, road: 'A1' }))
    const raw = f.filter((x) => x.key === null).map((x) => x.rawLabel)
    expect(raw).toEqual(['heading', 'road'])
  })

  it('does not repeat a fact it already spelled out', () => {
    const f = eventFacts(row('geofence', { geofenceId: 'g1', name: 'Depot', transition: 'exit' }))
    expect(f.some((x) => x.rawLabel === 'name' || x.rawLabel === 'geofenceId')).toBe(false)
  })

  it('renders an object payload value as JSON, never as [object Object]', () => {
    const f = eventFacts(row('panic', { rule: 'r', alarm: true, extra: { a: 1 } }))
    expect(f.find((x) => x.rawLabel === 'extra')?.value).toBe('{"a":1}')
  })
})
