import type { EventView } from '@orbetra/shared'

import { getJson } from './client'

/**
 * Events read client (E05-6). Read-only, account-scoped on the server. Rows are the
 * pipeline's rule/geofence output (E05-2/4): kind, device, when (`at`), position (null for
 * device_offline), and a kind-specific `payload`.
 */
export type EventRow = EventView

/** Event kinds the pipeline emits (geofence + the E05-4 engine + sweeper kinds). Must stay in
 * lockstep with the worker's ENGINE_RULE_KINDS + the Prisma RuleKind enum — a kind missing here
 * is unfilterable on the events page and silently un-subscribable in the webhook UI. */
export const EVENT_KINDS = ['geofence', 'overspeed', 'ignition', 'din_change', 'power_cut', 'low_battery', 'panic', 'device_offline', 'fuel_theft'] as const
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

export type EventSeverity = 'critical' | 'warning' | 'info'

/**
 * The ONE severity mapping.
 *
 * It lived in `dashboard.ts` while five modules read it and two others quietly kept their own —
 * the map ticker's (mine, last commit) and the events page's, which drove that page's badge, its
 * severity filter AND its Critical count. One fuel-theft record could be red on the map and grey
 * in the count meant to catch it. Here, beside the rest of the event semantics, so a kind whose
 * severity is wrong is wrong once.
 */
export function eventSeverity(kind: string): EventSeverity {
  if (kind === 'panic' || kind === 'power_cut') return 'critical'
  if (kind === 'overspeed' || kind === 'low_battery' || kind === 'device_offline') return 'warning'
  return 'info'
}

/**
 * Severity as a Badge/dot tone.
 *
 * A THIN view over `eventSeverity`, never a table of its own.
 */
export const eventTone = (kind: string): 'danger' | 'warn' | 'default' => {
  const s = eventSeverity(kind)
  return s === 'critical' ? 'danger' : s === 'warning' ? 'warn' : 'default'
}

/** A short, human-readable one-line summary of an event's payload, per kind. Pure. */
export function eventSummary(e: EventRow): string {
  const p = e.payload ?? {}
  switch (e.kind) {
    case 'overspeed':
      // a unit belongs to a value the device sent — the same rule `eventSummaryT` follows
      return `${typeof p['speedKmh'] === 'number' ? `${num(p['speedKmh'])} km/h` : '—'} > ${num(p['limitKmh'])}`
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
    case 'fuel_theft':
      return `fuel dropped ${num(p['drop'])} ${p['unit'] === 'liters' ? 'L' : '%'}`
    default:
      return ''
  }
}

/** Display options for summaries: fmtSpeed renders a km/h value in the user's speed unit
 * (useUnits().speed) — overspeed summaries then read '45 mph > 56 mph' instead of km/h. fmtVolume
 * renders a litre value in the user's volume unit (useUnits().volumeL) so a litre fuel-theft drop
 * reads in gallons for gallons accounts (and the unit label is localized, not a hardcoded 'L'). */
export interface SummaryOpts {
  fmtSpeed?: (kmh: number) => string
  fmtVolume?: (liters: number) => string
}

/** i18n descriptor for an event summary: a key under events.s.* plus interpolation params.
 * Pure — unit-tested. Render via localizedEventSummary (falls back to eventSummary for
 * unknown kinds / missing catalog entries so nothing regresses to an empty cell). */
export function eventSummaryT(e: EventRow, opts: SummaryOpts = {}): { key: string; params: Record<string, string> } | null {
  const p = e.payload ?? {}
  // A unit belongs to a value the device sent. Bolting "km/h" onto a missing one printed
  // "— km/h > 56 mph" on an mph account: two unit systems in one line, one of them invented.
  const speed = (v: unknown): string =>
    typeof v !== 'number' ? num(v) : opts.fmtSpeed !== undefined ? opts.fmtSpeed(v) : `${v} km/h`
  switch (e.kind) {
    case 'overspeed':
      return { key: 'events.s.overspeed', params: { speed: speed(p['speedKmh']), limit: speed(p['limitKmh']) } }
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
    case 'fuel_theft': {
      // litres drop → honor the volume-unit pref (fmtVolume carries its own localized unit label);
      // percentage drop has no volume conversion and keeps the '%' unit
      const liters = p['unit'] === 'liters'
      if (liters && typeof p['drop'] === 'number' && opts.fmtVolume !== undefined) {
        return { key: 'events.s.fuel_theft_vol', params: { drop: opts.fmtVolume(p['drop']) } }
      }
      return { key: 'events.s.fuel_theft', params: { drop: num(p['drop']), unit: liters ? 'L' : '%' } }
    }
    default:
      return null
  }
}

/** Translator shape we need from react-i18next's t (kept structural so the lib stays UI-free). */
export type TFn = (key: string, options?: Record<string, unknown>) => string

/** Localized one-line event summary: eventSummaryT rendered through t(), with the pure
 * English eventSummary as the defaultValue fallback. Pass opts.fmtSpeed (useUnits().speed)
 * so overspeed summaries follow the display speed unit. */
/**
 * Keys whose string only restates the KIND label, in every language.
 *
 * A list, not a shape test. The first attempt asked "does the descriptor interpolate anything" —
 * and `ignition` and `din_change` carry their fact in the KEY (`ignition_on` vs `ignition_off`,
 * `din_on` vs `din_off`), so it hid the one thing the operator needs: whether the vehicle STARTED
 * or STOPPED. Two of nine kinds, silently, in the branch whose whole point was that a row must say
 * more than its own name.
 *
 * `panic` → "SOS triggered" under a badge reading "Panic", and `power_cut` → "external power lost"
 * under "Power cut", genuinely add nothing. Nothing else belongs here.
 */
const REDUNDANT_SUMMARY = new Set(['events.s.panic', 'events.s.power_cut'])

/** Does this rendered summary consist of nothing but placeholders? A row of "— · —" is the absence
 *  of information wearing the shape of information. */
const allPlaceholder = (params: Record<string, string>): boolean =>
  Object.keys(params).length > 0 && Object.values(params).every((v) => v === '—')

/**
 * The summary, but only when it says something the KIND label does not.
 *
 * Used wherever the label is already on screen — the map ticker and the inspector — so a row is
 * never two restatements of one word.
 */
export function eventDetail(t: TFn, e: EventRow, opts: SummaryOpts = {}): string {
  const d = eventSummaryT(e, opts)
  if (d === null || REDUNDANT_SUMMARY.has(d.key) || allPlaceholder(d.params)) return ''
  return localizedEventSummary(t, e, opts)
}

export function localizedEventSummary(t: TFn, e: EventRow, opts: SummaryOpts = {}): string {
  const d = eventSummaryT(e, opts)
  if (d === null) return eventSummary(e)
  return t(d.key, { ...d.params, defaultValue: eventSummary(e) })
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : '—'
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '—'
}

/**
 * The event, broken into LABELLED FACTS.
 *
 * The details panel used to print `JSON.stringify(payload)`. That is the database's answer to
 * "what happened", not the operator's: it exposes our field names, our units and our nulls, and it
 * asks a dispatcher to parse braces to learn that a van was doing 105 in a 90 zone.
 *
 * The one-line summary above already says WHAT happened. This says it in parts — each number with
 * its own label and unit — which is what a detail view is for, and what makes the difference
 * between "105 km/h > 90 km/h" and being able to see that the limit came from a rule called
 * "Greičio viršijimas 90".
 *
 * Unknown keys are NOT dropped. A payload field this function has never heard of is still listed,
 * labelled by its own name — a new event kind then renders as an ugly-but-complete list instead of
 * silently hiding data, which is the failure mode that would make an operator distrust the screen.
 */
export interface EventFact {
  /** i18n key for the label, or null when `rawLabel` carries an unknown payload key verbatim */
  key: string | null
  rawLabel?: string
  value: string
  /** i18n key for the VALUE, when the value is a word rather than a measurement. A label with an
   *  empty value renders as a heading with nothing beside it — "ENTERED" floating alone in a grid
   *  of label/value pairs, which reads as data that failed to load. */
  valueKey?: string
}

/** Payload keys already spoken for by a kind's own facts — never repeated in the "other" tail. */
const CLAIMED: Record<string, readonly string[]> = {
  overspeed: ['rule', 'speedKmh', 'limitKmh', 'maxSpeedKmh'],
  low_battery: ['rule', 'volts', 'thresholdV'],
  ignition: ['rule', 'ignition'],
  din_change: ['rule', 'din1'],
  power_cut: ['rule', 'unplug'],
  panic: ['rule', 'alarm'],
  fuel_theft: ['rule', 'unit', 'baseline', 'to', 'drop'],
  device_offline: ['rule', 'lastFixMs', 'thresholdH', 'offlineH'],
  geofence: ['geofenceId', 'name', 'transition'],
}

export function eventFacts(e: EventRow, opts: SummaryOpts & { onOff?: (on: boolean) => string } = {}): EventFact[] {
  const p = e.payload ?? {}
  const out: EventFact[] = []
  const speed = (v: unknown): string =>
    typeof v !== 'number' ? num(v) : opts.fmtSpeed !== undefined ? opts.fmtSpeed(v) : `${v} km/h`
  const onOff = (on: boolean): string => (opts.onOff !== undefined ? opts.onOff(on) : on ? 'on' : 'off')

  // An interval, not an instant — printed FIRST, because "for how long" is the question the
  // cooldown's five identical rows could never answer.
  if (typeof e.endedAt === 'string' && e.endedAt !== '') {
    const ms = Date.parse(e.endedAt) - Date.parse(e.at)
    if (Number.isFinite(ms) && ms > 0) out.push({ key: 'events.f.duration', value: humanDuration(ms) })
  }

  switch (e.kind) {
    case 'overspeed': {
      const at = typeof p['speedKmh'] === 'number' ? p['speedKmh'] : null
      // the worst moment of the breach, which the cooldown used to throw away
      const peak = typeof p['maxSpeedKmh'] === 'number' && (at === null || p['maxSpeedKmh'] > at) ? p['maxSpeedKmh'] : null
      out.push({ key: 'events.f.speed', value: speed(p['speedKmh']) })
      if (peak !== null) out.push({ key: 'events.f.peak', value: speed(peak) })
      out.push({ key: 'events.f.limit', value: speed(p['limitKmh']) })
      /**
       * How far over, measured from the WORST moment — not from the speed that happened to trip
       * the rule.
       *
       * This read `speedKmh - limitKmh`, which was right when an overspeed was a single instant.
       * Once events became intervals carrying a peak, the panel started contradicting itself: peak
       * 97, limit 90, "over by 3". The reader can subtract two rows above for themselves; the
       * number worth stating is the one they act on, and nobody disciplines a driver for the speed
       * at which the alarm happened to fire.
       */
      if (at !== null && typeof p['limitKmh'] === 'number') {
        out.push({ key: 'events.f.over', value: speed((peak ?? at) - p['limitKmh']) })
      }
      break
    }
    case 'low_battery':
      out.push({ key: 'events.f.volts', value: `${num(p['volts'])} V` })
      out.push({ key: 'events.f.threshold', value: `${num(p['thresholdV'])} V` })
      break
    case 'ignition':
      out.push({ key: 'events.f.state', value: onOff(p['ignition'] === true) })
      break
    case 'din_change':
      out.push({ key: 'events.f.state', value: onOff(p['din1'] === true) })
      break
    case 'geofence':
      out.push({ key: 'events.f.zone', value: str(p['name']) })
      out.push({ key: 'events.f.direction', value: '', valueKey: `events.f.transition_${str(p['transition'])}` })
      break
    case 'device_offline':
      out.push({ key: 'events.f.offlineFor', value: `${num(p['offlineH'])} h` })
      out.push({ key: 'events.f.threshold', value: `${num(p['thresholdH'])} h` })
      if (typeof p['lastFixMs'] === 'number') out.push({ key: 'events.f.lastFix', value: new Date(p['lastFixMs']).toISOString() })
      break
    case 'fuel_theft': {
      const liters = p['unit'] === 'liters'
      const fmt = (v: unknown): string =>
        liters && typeof v === 'number' && opts.fmtVolume !== undefined ? opts.fmtVolume(v) : `${num(v)}${liters ? ' L' : ' %'}`
      out.push({ key: 'events.f.from', value: fmt(p['baseline']) })
      out.push({ key: 'events.f.to', value: fmt(p['to']) })
      out.push({ key: 'events.f.drop', value: fmt(p['drop']) })
      break
    }
    default:
      break
  }

  // the rule that fired, when the payload names one — "which of my rules did this" is the first
  // question after "what happened", and the JSON was the only place it was ever visible
  if (typeof p['rule'] === 'string' && p['rule'] !== '' && p['rule'] !== e.kind) {
    out.push({ key: 'events.f.rule', value: p['rule'] })
  }

  const claimed = new Set([...(CLAIMED[e.kind] ?? []), 'rule'])
  for (const [k, v] of Object.entries(p)) {
    if (claimed.has(k) || v === null || v === undefined) continue
    // String(v) on an object yields "[object Object]" — the one rendering that is worse than the
    // JSON this panel replaced, because it looks like a value while carrying none
    const shown = typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' || typeof v === 'number' ? String(v) : str(v)
    out.push({ key: null, rawLabel: k, value: shown })
  }
  return out
}

/** "22 min", "9 h 5 min", "46 s" — a duration a dispatcher reads at a glance. */
export function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h} h` : `${h} h ${rem} min`
}
