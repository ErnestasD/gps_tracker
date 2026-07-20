import type { PositionView, TripView } from '@orbetra/shared'

import { getJson } from './client'

/** History/playback API client (E04-3). Positions are chronological (fixTime ASC). */

export interface HistoryQuery {
  from?: string
  to?: string
  limit?: number
}

export function historyQuery(q: HistoryQuery): string {
  const p = new URLSearchParams()
  if (q.from) p.set('from', q.from)
  if (q.to) p.set('to', q.to)
  if (q.limit !== undefined) p.set('limit', String(q.limit))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const listPositions = (deviceId: string, q: HistoryQuery = {}) =>
  getJson<PositionView[]>(`/v1/devices/${encodeURIComponent(deviceId)}/positions${historyQuery(q)}`)

export const listDeviceTrips = (deviceId: string, q: HistoryQuery = {}) =>
  getJson<TripView[]>(`/v1/devices/${encodeURIComponent(deviceId)}/trips${historyQuery(q)}`)

/** Offset (ms) of `timeZone` from UTC at the given instant (wall-clock − UTC). Intl-based,
 * DST-correct. Throws on an invalid zone (callers fall back to browser-local). Pure. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - utcMs
}

/** UTC epoch ms of the wall-clock Y/M/D hh:mm:ss.mmm as read in `timeZone` (two-pass DST refine).
 * The offset is computed at second resolution (Intl parts carry no ms); ms is added back after. */
function zonedWallToUtcMs(y: number, mIndex: number, d: number, hh: number, mm: number, ss: number, ms: number, timeZone: string): number {
  const guess = Date.UTC(y, mIndex, d, hh, mm, ss, 0)
  const offset = tzOffsetMs(guess, timeZone)
  const utc = guess - offset
  const offset2 = tzOffsetMs(utc, timeZone)
  return (offset2 === offset ? utc : guess - offset2) + ms
}

/** Y/M/D of `utcMs` as read in `timeZone` (or the browser zone when omitted). */
function ymdInZone(utcMs: number, timeZone?: string): { y: number; mIndex: number; d: number } {
  if (timeZone === undefined) {
    const l = new Date(utcMs)
    return { y: l.getFullYear(), mIndex: l.getMonth(), d: l.getDate() }
  }
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const parts = dtf.formatToParts(new Date(utcMs))
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
    return { y: get('year'), mIndex: get('month') - 1, d: get('day') }
  } catch {
    const l = new Date(utcMs)
    return { y: l.getFullYear(), mIndex: l.getMonth(), d: l.getDate() }
  }
}

/** Day query bounds for the DatePicker filters (ADR-028 round-2 amendment: date pickers are
 * date-only per the Lovable reference). A picked day covers its FULL day — 00:00:00.000 to
 * 23:59:59.999 — converted to ISO/UTC at the query edge. The day is anchored in `timeZone` (the
 * display-prefs zone) so the window matches the day LABELS the user sees; omit it to keep the
 * legacy browser-local behavior. DB stays UTC. Pure. */
export function dayStartIso(d: Date, timeZone?: string): string {
  if (timeZone === undefined) {
    const s = new Date(d)
    s.setHours(0, 0, 0, 0)
    return s.toISOString()
  }
  try {
    return new Date(zonedWallToUtcMs(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0, timeZone)).toISOString()
  } catch {
    const s = new Date(d)
    s.setHours(0, 0, 0, 0)
    return s.toISOString()
  }
}

export function dayEndIso(d: Date, timeZone?: string): string {
  if (timeZone === undefined) {
    const e = new Date(d)
    e.setHours(23, 59, 59, 999)
    return e.toISOString()
  }
  try {
    return new Date(zonedWallToUtcMs(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999, timeZone)).toISOString()
  } catch {
    const e = new Date(d)
    e.setHours(23, 59, 59, 999)
    return e.toISOString()
  }
}

/** Default playback/trips filter range: yesterday → today (their full days cover the last 24 h,
 * so a device that just reported is always inside the default window). "Today" is resolved in
 * `timeZone` (display-prefs zone) when given, so the default day matches the rendered labels; the
 * returned Dates carry that calendar day as their browser-local Y/M/D (what the DatePicker shows).
 * Pure. */
export function defaultDayRange(now: number, timeZone?: string): { from: Date; to: Date } {
  const { y, mIndex, d } = ymdInZone(now, timeZone)
  const to = new Date(y, mIndex, d) // local Date carrying the zone's calendar "today"
  const from = new Date(y, mIndex, d)
  from.setDate(from.getDate() - 1) // yesterday (normalizes across DST/month ends)
  return { from, to }
}
