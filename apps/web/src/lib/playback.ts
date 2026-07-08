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

/** The default range for the playback page: the last 24 h, as datetime-local values. */
export function defaultRange(now: number): { from: string; to: string } {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) // yyyy-mm-ddThh:mm
  return { from: iso(now - 24 * 3_600_000), to: iso(now) }
}
