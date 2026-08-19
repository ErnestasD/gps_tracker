/**
 * The scrubber's window, and the jumps that index into it.
 *
 * Pure and separate from the components because both have already been wrong in ways only a test
 * would have caught: a window frozen at selection made "now" mean four hours ago on a map that
 * stays open all day, and a replay start rounded to the nearest minute landed BEFORE the first row
 * about half the time, opening on a frozen camera.
 */
import type { TrackPoint } from './telemetry'

export interface TrackWindow {
  from: number
  to: number
}

export const TRACK_HOURS = 24

/**
 * The window is bucketed, not continuous.
 *
 * Every distinct `to` is a distinct react-query key, and a new key is a cache MISS — so a window
 * that advanced every minute re-downloaded the whole 24 hours every minute, blanking the history
 * line and disabling the scrubber while it was in flight. Five minutes keeps "now" honest enough
 * for a history tail (the live marker and the live trail cover the present anyway) at a fifth of
 * the traffic.
 */
export const WINDOW_BUCKET_MS = 5 * 60_000

export function windowAt(nowMs: number): TrackWindow {
  const to = Math.floor(nowMs / WINDOW_BUCKET_MS) * WINDOW_BUCKET_MS
  return { from: to - TRACK_HOURS * 3_600_000, to }
}

/** Whole minutes spanned by the window — the scrubber's axis. */
export const spanMinutes = (w: TrackWindow): number => Math.max(1, Math.round((w.to - w.from) / 60_000))

/**
 * How far back a replay should START: the first row we can actually PLACE.
 *
 * Two rules, each learned the hard way. The first VALID row, not the first row — an invalid record
 * is a state and never a place (I6), so a vehicle that spent the small hours in a garage would
 * otherwise open on "no GPS fix" and a frozen camera. And `floor`, not `round` — rounding away from
 * now lands strictly before that row, which is the same frozen camera by a different route.
 */
export function firstPlaceBack(points: readonly TrackPoint[], w: TrackWindow, times?: readonly number[]): number {
  const span = spanMinutes(w)
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    if (!p.fixValid) continue
    const ms = times?.[i] ?? Date.parse(p.fixTime)
    if (!Number.isFinite(ms)) continue
    return Math.min(span, Math.max(1, Math.floor((w.to - ms) / 60_000)))
  }
  return span
}

/**
 * The quick-jump buttons, derived from the window rather than hardcoded.
 *
 * They used to be literal 1440/720/360/60 while the span was computed, which agrees only as long as
 * the window is exactly 24 h. Narrow it and "-24 h" becomes a slider value below `min`: the browser
 * clamps the thumb while the state says otherwise, and the fill goes negative.
 */
export function quickJumps(spanMin: number): { m: number; hours: number }[] {
  const raw = [spanMin, Math.round(spanMin / 2), Math.round(spanMin / 4), Math.min(60, spanMin), 0]
  const seen = new Set<number>()
  const out: { m: number; hours: number }[] = []
  for (const m of raw) {
    if (seen.has(m)) continue
    seen.add(m)
    out.push({ m, hours: m / 60 })
  }
  return out
}
