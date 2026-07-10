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

/** The default range for the playback page: the last 24 h, as datetime-local values.
 * datetime-local strings are LOCAL wall-clock — they must be formatted from local Date
 * components. The old `toISOString().slice(0,16)` emitted UTC wall-clock, which the page
 * then re-parsed as local: east of UTC the range ended `offset` hours in the past, hiding
 * the freshest positions (found when the playback e2e stopped tolerating an empty state). */
export function defaultRange(now: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = (ms: number) => {
    const d = new Date(ms)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  // `to` is CEILED to the next minute: datetime-local has minute precision, and flooring
  // would exclude positions from the current partial minute (a device that just reported
  // would look absent from "the last 24 h").
  return { from: local(now - 24 * 3_600_000), to: local(now + 60_000) }
}
