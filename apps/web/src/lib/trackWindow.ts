/**
 * The scrubber's window, and the jumps that index into it.
 *
 * Pure and separate from the components because both have already been wrong in ways only a test
 * would have caught: a window frozen at selection made "now" mean four hours ago on a map that
 * stays open all day, and a replay start rounded to the nearest minute landed BEFORE the first row
 * about half the time, opening on a frozen camera.
 */
import { isNullIsland } from '@orbetra/shared'

import type { TrackPoint } from './telemetry'

export interface TrackWindow {
  from: number
  to: number
}

export const TRACK_HOURS = 24

/** The spans the zoom control cycles through, in hours. Bounded on both ends: below an hour a
 * 5-minute window bucket is a visible fraction of the axis, above a day the endpoint pages. */
export const SPAN_OPTIONS_H = [1, 3, 6, 12, 24] as const

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

export function windowAt(nowMs: number, hours: number = TRACK_HOURS): TrackWindow {
  const to = Math.floor(nowMs / WINDOW_BUCKET_MS) * WINDOW_BUCKET_MS
  return { from: to - hours * 3_600_000, to }
}

/** Whole minutes spanned by the window — the scrubber's axis. */
export const spanMinutes = (w: TrackWindow): number => Math.max(1, Math.round((w.to - w.from) / 60_000))

/**
 * How far back a replay should START: the first row we can actually PLACE.
 *
 * Three rules, each learned the hard way. The first VALID row, not the first row — an invalid
 * record is a state and never a place (I6), so a vehicle that spent the small hours in a garage
 * would otherwise open on "no GPS fix" and a frozen camera. `floor`, not `round` — rounding away
 * from now lands strictly before that row, which is the same frozen camera by a different route.
 * And a floor of ZERO, not one: a tracker installed twenty minutes ago has its first placeable row
 * inside the last minute of the window, and clamping that up to 1 puts the moment before the row
 * again. Zero means "there is nothing behind us to replay", and the caller says so.
 *
 * `null` — nothing in this window can be placed at all — is deliberately NOT the span. Returning
 * the span for both "the oldest placeable row is at the far edge" and "there is no placeable row"
 * gave one value two meanings, and the caller could only guard the first: a tracker that spent the
 * whole day underground had points, so the scrubber was enabled, and every moment it named
 * resolved to nowhere.
 */
export function firstPlaceBack(points: readonly TrackPoint[], w: TrackWindow, times?: readonly number[]): number | null {
  const span = spanMinutes(w)
  const ts = pairedTimes(points, times)
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    // placeable, not merely valid: this function's whole purpose is to refuse to open a replay on
    // a moment that resolves to nowhere, and `placeAt` refuses a stored 0/0. Disagreeing here
    // re-enables the scrubber with nothing to place — the frozen camera this was written against.
    if (!p.fixValid || isNullIsland(p.lat, p.lon)) continue
    const ms = ts?.[i] ?? Date.parse(p.fixTime)
    if (!Number.isFinite(ms)) continue
    return Math.min(span, Math.max(0, Math.floor((w.to - ms) / 60_000)))
  }
  return null
}

/**
 * Can this track be scrubbed at all?
 *
 * False when nothing in the window can be placed, and false when the only placeable row is inside
 * the last minute — in both cases every past moment the slider can name resolves to nowhere, so the
 * controls that would name one are disabled rather than answering "no report at …" to every press.
 */
export const canScrub = (earliest: number | null): earliest is number => earliest !== null && earliest > 0

/**
 * A `times` array is only usable if it was built from THESE points.
 *
 * A shorter one degrades safely (`?.[i]` falls back to parsing), but a same-length array from a
 * different track yields confidently wrong timestamps with no error at all. Mismatched length is
 * the only mismatch we can detect, and detecting it is worth the comparison.
 */
export const pairedTimes = (
  points: readonly TrackPoint[],
  times: readonly number[] | undefined,
): readonly number[] | undefined => (times !== undefined && times.length === points.length ? times : undefined)

/**
 * The quick-jump buttons, derived from the window rather than hardcoded.
 *
 * They used to be literal 1440/720/360/60 while the span was computed, which agrees only as long as
 * the window is exactly 24 h. Narrow it and "-24 h" becomes a slider value below `min`: the browser
 * clamps the thumb while the state says otherwise, and the fill goes negative.
 */
export function quickJumps(spanMin: number): { m: number }[] {
  const raw = [spanMin, Math.round(spanMin / 2), Math.round(spanMin / 4), Math.min(60, spanMin), 0]
  // Sorted, because clamping "-1 h" into range fixed the value and not the ORDER: a 90-minute span
  // produced -1.5 h · -45 min · -23 min · -1 h · now, where the fourth button jumps further back
  // than the third.
  return [...new Set(raw)].sort((a, b) => b - a).map((m) => ({ m }))
}
