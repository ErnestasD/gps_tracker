import type { LiveEvent } from '@orbetra/shared'

import { ONLINE_MS, STALE_MS } from './liveStore'

/**
 * Overview dashboard helpers (ADR-028 Apžvalga page). Pure — unit-tested. The page composes
 * REAL data only: last positions (presence), events (24 h), and the mileage report (7 d).
 */

export interface FleetCounts {
  online: number
  stale: number
  offline: number
}

/** Presence buckets from the last-position snapshot (same freshness rules as the live map). */
export function fleetCounts(events: LiveEvent[], nowMs: number): FleetCounts {
  const out: FleetCounts = { online: 0, stale: 0, offline: 0 }
  for (const e of events) {
    const age = nowMs - e.fixTimeMs
    if (age <= ONLINE_MS) out.online++
    else if (age <= STALE_MS) out.stale++
    else out.offline++
  }
  return out
}

export type EventSeverity = 'critical' | 'warning' | 'info'

/** Severity mapping shared with the events page StatCards (panic/power_cut are life/asset-critical). */
export function eventSeverity(kind: string): EventSeverity {
  if (kind === 'panic' || kind === 'power_cut') return 'critical'
  if (kind === 'overspeed' || kind === 'low_battery' || kind === 'device_offline') return 'warning'
  return 'info'
}

/** Aggregate the mileage report's rows (day/deviceId/trips/distanceM) into per-day fleet km,
 *  ordered by day ascending. Garbage values coerce to 0 (jsonb rows are untyped). */
export function dailyKmSeries(rows: Record<string, unknown>[]): { day: string; km: number }[] {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    const day = typeof r['day'] === 'string' ? r['day'] : ''
    if (day === '') continue
    const m = Number(r['distanceM'])
    byDay.set(day, (byDay.get(day) ?? 0) + (Number.isFinite(m) ? m : 0))
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, meters]) => ({ day, km: Math.round(meters / 100) / 10 }))
}
