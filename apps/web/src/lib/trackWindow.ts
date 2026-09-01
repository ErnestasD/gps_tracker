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

/* ────────────────────────────────────────────────────────────────────────────
 * PANNING AND DAYS
 *
 * The window used to END at `now`, always. Zooming therefore only ever narrowed onto the present:
 * an operator who wanted to see what happened around 12:00 zoomed in and got the last hour, with no
 * way to travel. The fix is one extra piece of state — where the window's right edge is pinned —
 * and everything else follows from it.
 * ──────────────────────────────────────────────────────────────────────────── */

/** How far back the day picker and panning reach. */
export const HISTORY_DAYS = 7

export interface TrackView {
  /** the axis span in hours (the zoom) */
  spanH: number
  /**
   * Epoch ms of the window's right edge, or `null` for LIVE.
   *
   * `null` is not "now at the time this was set" — it is a standing instruction to follow the
   * present, which is what keeps the axis advancing while an operator watches. Storing a number
   * there instead would freeze the view the moment the page loaded.
   */
  anchorTo: number | null
}

export const LIVE_VIEW: TrackView = { spanH: TRACK_HOURS, anchorTo: null }
export const isLive = (v: TrackView): boolean => v.anchorTo === null

/** The concrete window a view resolves to right now. */
export function viewWindow(v: TrackView, nowMs: number): TrackWindow {
  if (v.anchorTo === null) return windowAt(nowMs, v.spanH)
  const to = Math.floor(v.anchorTo / WINDOW_BUCKET_MS) * WINDOW_BUCKET_MS
  return { from: to - v.spanH * 3_600_000, to }
}

/** The oldest instant any view may reach — the day picker's floor, so panning and picking agree. */
export const panFloor = (nowMs: number): number => nowMs - HISTORY_DAYS * 86_400_000

/**
 * Move the window by `deltaMs` (negative = into the past).
 *
 * Two clamps, and each exists because its absence produced a nonsense view. Panning forward past
 * the present RETURNS TO LIVE rather than pinning the edge at now: a pinned "now" stops advancing,
 * so the axis silently falls behind and the operator believes they are watching live when they are
 * not. Panning backwards stops at the same floor the day picker offers, because a window we will
 * not fetch data for is a window that renders as an empty graph and reads as a broken device.
 */
export function panView(v: TrackView, deltaMs: number, nowMs: number): TrackView {
  const current = v.anchorTo ?? nowMs
  const next = current + deltaMs
  if (next >= nowMs) return { spanH: v.spanH, anchorTo: null }
  const floor = panFloor(nowMs) + v.spanH * 3_600_000
  return { spanH: v.spanH, anchorTo: Math.max(floor, next) }
}

/**
 * Change the zoom, keeping what the operator is LOOKING AT in view.
 *
 * While live, zooming keeps the right edge at the present — narrowing onto "just now" is what
 * someone at the live edge means by zoom, and moving it would drag them off live for pressing +.
 * Once panned into history the CENTRE is held instead, so zooming in inspects the stretch on
 * screen rather than teleporting to a different hour.
 */
export function zoomView(v: TrackView, spanH: number, nowMs: number): TrackView {
  if (v.anchorTo === null) return { spanH, anchorTo: null }
  const centre = v.anchorTo - (v.spanH * 3_600_000) / 2
  const anchor = Math.min(nowMs, centre + (spanH * 3_600_000) / 2)
  return anchor >= nowMs ? { spanH, anchorTo: null } : { spanH, anchorTo: Math.max(panFloor(nowMs) + spanH * 3_600_000, anchor) }
}

/* ── day boundaries in the ACCOUNT's zone ─────────────────────────────────────
 *
 * A "day" is a local calendar day, and computing one with plain millisecond arithmetic is the
 * banned shortcut CLAUDE.md rule 7 names: `now - 86_400_000` is 24 hours ago, which on the two
 * days a year the clocks change is not the same instant as yesterday's midnight. `date-fns-tz`
 * would solve it and would also be a new runtime dependency (rule 10), so this uses `Intl` — the
 * same mechanism the rest of `datetime.ts` already renders with.
 * ──────────────────────────────────────────────────────────────────────────── */

const zoneParts = (atMs: number, timeZone: string): { y: number; m: number; d: number; ms: number } => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(atMs))) p[part.type] = part.value
  const y = Number(p['year'])
  const m = Number(p['month'])
  const d = Number(p['day'])
  return { y, m, d, ms: Date.UTC(y, m - 1, d, Number(p['hour']), Number(p['minute']), Number(p['second'])) }
}

/** The zone's UTC offset at an instant, in ms (positive east of Greenwich). */
const zoneOffsetMs = (atMs: number, timeZone: string): number => zoneParts(atMs, timeZone).ms - atMs

/**
 * The UTC instant of local midnight starting the calendar day `daysBack` before today.
 *
 * Two passes, because the offset depends on the answer: the first guess uses the offset at UTC
 * midnight, which is the wrong side of a DST change roughly twice a year, and the second uses the
 * offset at the instant the first pass produced. On the clocks-forward night local midnight may not
 * exist at all; the refinement lands on the first instant that does, which is the honest start of
 * that day.
 */
export function zonedDayStart(daysBack: number, timeZone: string, nowMs: number): number {
  const today = zoneParts(nowMs, timeZone)
  const target = Date.UTC(today.y, today.m - 1, today.d) - daysBack * 86_400_000
  const cal = new Date(target)
  const naive = Date.UTC(cal.getUTCFullYear(), cal.getUTCMonth(), cal.getUTCDate())
  const first = naive - zoneOffsetMs(naive, timeZone)
  return naive - zoneOffsetMs(first, timeZone)
}

/**
 * The view for a day chip. `0` is TODAY and resolves to the live 24-hour window rather than to
 * midnight-to-midnight: at 09:00 a calendar-day view would be three quarters empty, and the thing
 * an operator wants from "today" is the recent past, not the hours that have not happened.
 */
export function dayView(daysBack: number, timeZone: string, nowMs: number, spanH: number = TRACK_HOURS): TrackView {
  if (daysBack <= 0) return { spanH, anchorTo: null }
  const start = zonedDayStart(daysBack, timeZone, nowMs)
  const end = zonedDayStart(daysBack - 1, timeZone, nowMs)
  // the window ENDS at the day's end; its span covers the whole day, so the axis is that day
  return { spanH: Math.max(1, Math.round((end - start) / 3_600_000)), anchorTo: end }
}
