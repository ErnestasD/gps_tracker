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

/** i18n descriptor for an event summary: a key under events.s.* plus interpolation params.
 * Pure — unit-tested. Render via localizedEventSummary (falls back to eventSummary for
 * unknown kinds / missing catalog entries so nothing regresses to an empty cell). */
export function eventSummaryT(e: EventRow): { key: string; params: Record<string, string> } | null {
  const p = e.payload ?? {}
  switch (e.kind) {
    case 'overspeed':
      return { key: 'events.s.overspeed', params: { speed: num(p['speedKmh']), limit: num(p['limitKmh']) } }
    case 'low_battery':
      return { key: 'events.s.low_battery', params: { volts: num(p['volts']), threshold: num(p['thresholdV']) } }
    case 'ignition':
      return { key: p['ignition'] ? 'events.s.ignition_on' : 'events.s.ignition_off', params: {} }
    case 'din_change':
      return { key: p['din1'] ? 'events.s.din_on' : 'events.s.din_off', params: {} }
    case 'geofence': {
      const transition = str(p['transition'])
      const key = transition === 'enter' || transition === 'exit' ? `events.s.geofence_${transition}` : 'events.s.geofence'
      return { key, params: { name: str(p['name']), transition } }
    }
    case 'device_offline':
      return { key: 'events.s.device_offline', params: { hours: num(p['offlineH']), threshold: num(p['thresholdH']) } }
    case 'panic':
      return { key: 'events.s.panic', params: {} }
    case 'power_cut':
      return { key: 'events.s.power_cut', params: {} }
    default:
      return null
  }
}

/** Translator shape we need from react-i18next's t (kept structural so the lib stays UI-free). */
export type TFn = (key: string, options?: Record<string, unknown>) => string

/** Localized one-line event summary: eventSummaryT rendered through t(), with the pure
 * English eventSummary as the defaultValue fallback. */
export function localizedEventSummary(t: TFn, e: EventRow): string {
  const d = eventSummaryT(e)
  if (d === null) return eventSummary(e)
  return t(d.key, { ...d.params, defaultValue: eventSummary(e) })
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '—'
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '—'
}
