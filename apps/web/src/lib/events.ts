import type { EventView } from '@orbetra/shared'

import { getJson } from './client'

/**
 * Events read client (E05-6). Read-only, account-scoped on the server. Rows are the
 * pipeline's rule/geofence output (E05-2/4): kind, device, when (`at`), position (null for
 * device_offline), and a kind-specific `payload`.
 */
export type EventRow = EventView

/** Event kinds the pipeline emits (geofence + the E05-4 engine + sweeper kinds). */
export const EVENT_KINDS = ['geofence', 'overspeed', 'ignition', 'din_change', 'power_cut', 'low_battery', 'panic', 'device_offline'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export interface EventFilters {
  kind?: string
  deviceId?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

/** Build the /v1/events query string from filters (drops empty values). Pure — unit-tested. */
export function eventsQuery(f: EventFilters): string {
  const p = new URLSearchParams()
  if (f.kind) p.set('kind', f.kind)
  if (f.deviceId) p.set('deviceId', f.deviceId)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.cursor) p.set('cursor', f.cursor)
  if (f.limit !== undefined) p.set('limit', String(f.limit))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const listEvents = (f: EventFilters = {}) => getJson<EventRow[]>(`/v1/events${eventsQuery(f)}`)

/** A short, human-readable one-line summary of an event's payload, per kind. Pure. */
export function eventSummary(e: EventRow): string {
  const p = e.payload ?? {}
  switch (e.kind) {
    case 'overspeed':
      return `${num(p['speedKmh'])} km/h > ${num(p['limitKmh'])}`
    case 'low_battery':
      return `${num(p['volts'])} V < ${num(p['thresholdV'])}`
    case 'ignition':
      return `ignition ${p['ignition'] ? 'on' : 'off'}`
    case 'din_change':
      return `DIN1 ${p['din1'] ? 'on' : 'off'}`
    case 'geofence':
      return `${str(p['name'])} · ${str(p['transition'])}`
    case 'device_offline':
      return `offline ${num(p['offlineH'])} h (≥ ${num(p['thresholdH'])} h)`
    case 'panic':
      return 'SOS triggered'
    case 'power_cut':
      return 'external power lost'
    default:
      return ''
  }
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '—'
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '—'
}
