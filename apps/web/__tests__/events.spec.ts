import type { EventView } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { EVENT_KINDS, eventSummary, eventsQuery } from '../src/lib/events.js'

const ev = (kind: string, payload: Record<string, unknown>): EventView => ({
  id: '1',
  deviceId: '42',
  ruleId: 'r1',
  kind,
  at: '2026-07-09T00:00:00.000Z',
  lat: null,
  lon: null,
  payload,
  acknowledgedAt: null,
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

  it('handles missing payload fields without throwing', () => {
    expect(eventSummary(ev('overspeed', {}))).toBe('— km/h > —')
    expect(eventSummary(ev('panic', {}))).toBe('SOS triggered') // fixed one-liner, no payload needed
    expect(eventSummary(ev('power_cut', {}))).toBe('external power lost')
  })

  it('EVENT_KINDS includes geofence plus all engine + sweeper kinds', () => {
    expect(EVENT_KINDS).toContain('geofence')
    expect(EVENT_KINDS).toContain('device_offline')
    expect(EVENT_KINDS).toHaveLength(8)
  })
})
