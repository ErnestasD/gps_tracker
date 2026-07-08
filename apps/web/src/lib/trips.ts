import type { TripView } from '@orbetra/shared'

import { getJson } from './client'
import { historyQuery, type HistoryQuery } from './playback'

/** Trips list/detail client (E04-4). Backend routes land in E04-3. */

export interface TripsQuery extends HistoryQuery {
  deviceId?: string
}

export function tripsQuery(q: TripsQuery): string {
  const base = historyQuery(q)
  if (!q.deviceId) return base
  return base === '' ? `?deviceId=${encodeURIComponent(q.deviceId)}` : `${base}&deviceId=${encodeURIComponent(q.deviceId)}`
}

export const listTrips = (q: TripsQuery = {}) => getJson<TripView[]>(`/v1/trips${tripsQuery(q)}`)

/** Trip duration in ms; an open trip (no endTime) runs to `now`. Pure. */
export function tripDurationMs(t: Pick<TripView, 'startTime' | 'endTime'>, now: number): number {
  const start = Date.parse(t.startTime)
  const end = t.endTime === null ? now : Date.parse(t.endTime)
  const ms = end - start
  return Number.isFinite(ms) ? Math.max(0, ms) : 0 // malformed time → 0, never NaN
}

/** Compact H:MM:SS-ish duration. Pure. */
export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

/** Metres → km with one decimal. Pure. */
export const fmtKm = (m: number): string => `${(m / 1000).toFixed(1)} km`
