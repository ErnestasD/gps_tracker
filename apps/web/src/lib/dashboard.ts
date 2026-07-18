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

/** Distinct devices that logged any trip per day (mileage rows are per device+day), ascending.
 *  This is the "active devices" spark series — real data, same report the km chart uses. */
export function dailyActiveDevices(rows: Record<string, unknown>[]): { day: string; count: number }[] {
  const byDay = new Map<string, Set<string>>()
  for (const r of rows) {
    const day = typeof r['day'] === 'string' ? r['day'] : ''
    const dev = typeof r['deviceId'] === 'string' ? r['deviceId'] : typeof r['deviceId'] === 'number' ? String(r['deviceId']) : ''
    if (day === '' || dev === '') continue
    let set = byDay.get(day)
    if (set === undefined) byDay.set(day, (set = new Set()))
    set.add(dev)
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, s]) => ({ day, count: s.size }))
}

export interface Delta {
  value: string
  tone: 'up' | 'down' | 'flat'
}

/** Percent change vs a baseline, StatCard-ready ('+18%'/'−7%'/'0%'). Returns null when the
 *  baseline is 0 but today isn't — a percentage of nothing would be a made-up number. */
export function pctDelta(today: number, yesterday: number): Delta | null {
  if (yesterday <= 0) return today <= 0 ? { value: '0%', tone: 'flat' } : null
  const pct = Math.round(((today - yesterday) / yesterday) * 100)
  if (pct === 0) return { value: '0%', tone: 'flat' }
  return pct > 0 ? { value: `+${pct}%`, tone: 'up' } : { value: `−${-pct}%`, tone: 'down' }
}

/** Absolute count change vs the prior window ('+3'/'−2'/'±0'). */
export function countDelta(current: number, prev: number): Delta {
  const d = current - prev
  if (d === 0) return { value: '±0', tone: 'flat' }
  return d > 0 ? { value: `+${d}`, tone: 'up' } : { value: `−${-d}`, tone: 'down' }
}

/** Local calendar day (YYYY-MM-DD) for a Unix-ms timestamp. VIEWER-local (browser zone). */
export function localDayStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Calendar day (YYYY-MM-DD) for a timestamp in a specific IANA zone — so the dashboard's
 *  today/yesterday and daily sparks bucket on the SAME timezone basis as the mileage report
 *  (which buckets `day` by the account zone server-side) instead of the browser zone, killing the
 *  off-by-one when the two differ. `timeZone` omitted (or 'auto' → undefined at the call site)
 *  falls back to browser-local. Bad zone ids degrade to browser-local, never throw. */
export function dayStrInTz(ms: number, timeZone?: string): string {
  if (timeZone === undefined) return localDayStr(ms)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))
    const g = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
    return `${g('year')}-${g('month')}-${g('day')}`
  } catch {
    return localDayStr(ms)
  }
}

/** Hour-of-day (0–23) for an ISO timestamp in a specific IANA zone (matches how event times are
 *  rendered when a display-pref timezone is set). Omitted/`auto` → browser-local hour; NaN on
 *  unparseable input or a bad zone (dropped by hourlyBuckets). */
export function hourInTz(iso: string, timeZone?: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return Number.NaN
  if (timeZone === undefined) return new Date(ms).getHours()
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)))
  } catch {
    return new Date(ms).getHours()
  }
}

/** Count events per hour of day (0–23). `hourOf` defaults to the viewer-local hour, matching
 *  how every event timestamp on screen is rendered; injectable for deterministic tests and for
 *  bucketing in a chosen display-pref zone (hourInTz). Unparseable timestamps (NaN hour) are dropped. */
export function hourlyBuckets(events: { at: string }[], hourOf: (iso: string) => number = (iso) => new Date(iso).getHours()): number[] {
  const out = new Array<number>(24).fill(0)
  for (const e of events) {
    const h = hourOf(e.at)
    if (Number.isInteger(h) && h >= 0 && h < 24) out[h] = (out[h] ?? 0) + 1
  }
  return out
}

/** Events per local calendar day for the trailing `days` days ending at `nowMs` (oldest first).
 *  Day stepping uses setDate (not −24 h) so DST transitions can't skip/double a bucket. */
export function dailyCounts(events: { at: string }[], days: number, nowMs: number, dayOf: (iso: string) => string = (iso) => localDayStr(Date.parse(iso))): number[] {
  const keys: string[] = []
  const d = new Date(nowMs)
  // anchor to noon so the trailing-day keys, when resolved through a (possibly zoned) dayOf, never
  // land on the neighbouring calendar day — keeps keys and event buckets on the same basis
  d.setHours(12, 0, 0, 0)
  for (let i = 0; i < days; i++) {
    keys.unshift(dayOf(new Date(d).toISOString()))
    d.setDate(d.getDate() - 1)
  }
  const counts = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const e of events) {
    const k = dayOf(e.at)
    const c = counts.get(k)
    if (c !== undefined) counts.set(k, c + 1)
  }
  return keys.map((k) => counts.get(k) ?? 0)
}

/** Events grouped by kind, sorted by count desc (ties alphabetical) — donut/legend input. */
export function kindBreakdown(events: { kind: string }[]): { kind: string; count: number }[] {
  const m = new Map<string, number>()
  for (const e of events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1)
  return [...m.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1))
}

export interface DonutSegment {
  kind: string
  count: number
  /** stroke-dasharray: visible arc length + the rest of the circumference. */
  dash: string
  /** stroke-dashoffset: negative cumulative start (rotate(-90°) group puts 0 at 12 o'clock). */
  offset: number
}

/** Donut arc parameters for SVG circles of radius `r`: each segment's share of the circumference
 *  as stroke-dasharray/-offset, with a `gapPx` spacer carved between segments (single segment
 *  gets no gap). Empty/zero totals yield []. */
export function donutSegments(breakdown: { kind: string; count: number }[], r: number, gapPx = 2): DonutSegment[] {
  const total = breakdown.reduce((s, b) => s + b.count, 0)
  if (total <= 0) return []
  const C = 2 * Math.PI * r
  const gap = breakdown.length > 1 ? gapPx : 0
  let start = 0
  return breakdown.map((b) => {
    const len = (b.count / total) * C
    const visible = round2(Math.max(0.5, len - gap))
    const seg: DonutSegment = { kind: b.kind, count: b.count, dash: `${visible} ${round2(C - visible)}`, offset: round2(-start) }
    start += len
    return seg
  })
}

/** Smooth (Catmull-Rom → cubic bézier) SVG paths for a series scaled into a w×h box:
 *  `line` for the stroke, `area` closed to the baseline for the gradient fill. Control-point
 *  y is clamped to the box so the curve never overshoots the baseline or the top. */
export function areaPath(values: number[], w: number, h: number): { line: string; area: string } {
  const n = values.length
  if (n === 0) return { line: '', area: '' }
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => [n === 1 ? w / 2 : (i / (n - 1)) * w, h - (v / max) * h] as const)
  const clampY = (y: number): number => Math.min(h, Math.max(0, y))
  let line: string
  if (n === 1) {
    const y = round2(pts[0]![1])
    line = `M0,${y} L${round2(w)},${y}`
  } else {
    line = `M${round2(pts[0]![0])},${round2(pts[0]![1])}`
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]!
      const p1 = pts[i]!
      const p2 = pts[i + 1]!
      const p3 = pts[i + 2] ?? p2
      const c1x = p1[0] + (p2[0] - p0[0]) / 6
      const c1y = clampY(p1[1] + (p2[1] - p0[1]) / 6)
      const c2x = p2[0] - (p3[0] - p1[0]) / 6
      const c2y = clampY(p2[1] - (p3[1] - p1[1]) / 6)
      line += ` C${round2(c1x)},${round2(c1y)} ${round2(c2x)},${round2(c2y)} ${round2(p2[0])},${round2(p2[1])}`
    }
  }
  return { line, area: `${line} L${round2(w)},${round2(h)} L0,${round2(h)} Z` }
}

function round2(n: number): number {
  const v = Math.round(n * 100) / 100
  return v === 0 ? 0 : v // normalize -0 (Object.is-visible) to 0
}
