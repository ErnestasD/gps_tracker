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

/** Local-day query bounds for the DatePicker filters (ADR-028 round-2 amendment: date
 * pickers are date-only per the Lovable reference). A picked day covers the FULL local day —
 * from 00:00:00.000 to 23:59:59.999 — converted to ISO/UTC only at the query edge (render/
 * filter-side local-time handling; DB stays UTC). Pure. */
export function dayStartIso(d: Date): string {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s.toISOString()
}

export function dayEndIso(d: Date): string {
  const e = new Date(d)
  e.setHours(23, 59, 59, 999)
  return e.toISOString()
}

/** Default playback/trips filter range: yesterday → today (their full local days cover the
 * last 24 h, so a device that just reported is always inside the default window). Pure. */
export function defaultDayRange(now: number): { from: Date; to: Date } {
  const to = new Date(now)
  to.setHours(0, 0, 0, 0)
  const from = new Date(to.getTime() - 24 * 3_600_000)
  from.setHours(0, 0, 0, 0) // normalize across DST transitions
  return { from, to }
}
