import { getJson } from './client'

/**
 * What the device is actually reporting, and its last 24 hours.
 *
 * The rule this module exists to keep: nothing is displayed that the device did not send. There is
 * no fixed list of fields, because there is no fixed list of fields — a Teltonika tracker reports
 * between a dozen and several hundred AVL elements depending on model, firmware and configuration,
 * and which ones arrive is a fact about that vehicle, not something we can decide in advance.
 */

export interface LatestTelemetry {
  fixTime: string
  serverTime: string
  lat: number
  lon: number
  speed: number | null
  course: number | null
  altitude: number | null
  satellites: number | null
  fixValid: boolean
  ignition: boolean | null
  movement: boolean | null
  odometerM: string | null
  attrs: Record<string, unknown>
}

export const getTelemetry = (deviceId: string) =>
  getJson<LatestTelemetry | { empty: true }>(`/v1/devices/${encodeURIComponent(deviceId)}/telemetry`)

export const hasTelemetry = (t: LatestTelemetry | { empty: true } | undefined): t is LatestTelemetry =>
  t !== undefined && !('empty' in t)

/** One row of the parameters list. `documented` is false for a bare `io_<id>` the model's own
 *  wiki page does not name — worth showing as such rather than hiding. */
export interface TelemetryRow {
  key: string
  label: string
  value: string
  documented: boolean
}

/** `attrs` is jsonb, so a value can be any JSON. Anything that is not a scalar is shown as JSON
 *  rather than as "[object Object]" — a parameter we cannot render plainly is still evidence. */
const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (typeof v === 'number' || typeof v === 'string') return String(v)
  return JSON.stringify(v)
}

/**
 * The device's own parameters, sorted so the named ones lead.
 *
 * An `io_<id>` key means the pipeline could not name the element from this model's dictionary —
 * either the wiki page is incomplete for that model, or the name was ambiguous within the table and
 * the id was kept deliberately. Both are worth seeing.
 */
export function telemetryRows(attrs: Record<string, unknown>): TelemetryRow[] {
  const rows = Object.entries(attrs).map(([key, value]) => {
    const raw = /^io_(\d+)$/.exec(key)
    return {
      key,
      label: raw !== null ? `AVL ${raw[1]}` : key,
      value: fmt(value),
      documented: raw === null,
    }
  })
  return rows.sort((a, b) =>
    a.documented === b.documented ? a.label.localeCompare(b.label, undefined, { numeric: true }) : a.documented ? -1 : 1,
  )
}

/**
 * The handful of parameters an operator reads first, promoted out of the long list.
 *
 * A row is here because the device sent it — the same rule as the full list. What is added is a
 * BAR, and only where the scale is a documented fact rather than a guess: Teltonika's tables give
 * GSM signal as 1–5 (AVL 21) and battery/fuel level as a percentage (AVL 113 / 89), so those can be
 * drawn as a proportion of something. Values whose scale depends on the model — external voltage in
 * mV, RPM, temperatures — are shown as the device sent them, exactly as the parameters tab does.
 * Drawing a bar for those would require a maximum we do not have, and an invented maximum is a
 * claim about the vehicle.
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 */
export interface HighlightRow {
  key: string
  label: string
  value: string
  /** 0..1 for a bar, or null when the scale is unknown and only the value is honest. */
  pct: number | null
  tone: 'accent' | 'warn' | 'danger'
}

/** name (lower-cased) → how to scale it. Matched on the dictionary NAME, never on a raw AVL id:
 *  the same id means different things on different tables (see packages/codec dictionaries). */
const SCALES: Record<string, { max: number; lowIsBad: boolean }> = {
  'gsm signal': { max: 5, lowIsBad: true }, // AVL 21, range 1–5
  'battery level': { max: 100, lowIsBad: true }, // AVL 113, %
  'fuel level': { max: 100, lowIsBad: true }, // AVL 89, %
}

/** Order the highlights appear in. Anything not listed stays in the full parameters list. */
const HIGHLIGHT_ORDER = [
  'gsm signal',
  'gnss status',
  'external voltage',
  'battery voltage',
  'battery level',
  'fuel level',
  'engine rpm',
  'coolant temperature',
  'hdop',
  'gnss hdop',
  'sleep mode',
]

export function highlightRows(attrs: Record<string, unknown>): HighlightRow[] {
  const byName = new Map(Object.keys(attrs).map((k) => [k.toLowerCase(), k]))
  const out: HighlightRow[] = []
  for (const wanted of HIGHLIGHT_ORDER) {
    const key = byName.get(wanted)
    if (key === undefined) continue
    const raw = attrs[key]
    const scale = SCALES[wanted]
    let pct: number | null = null
    let tone: HighlightRow['tone'] = 'accent'
    if (scale !== undefined && typeof raw === 'number' && raw >= 0 && raw <= scale.max) {
      pct = raw / scale.max
      // a low signal or an empty tank is the thing worth noticing; the tone says so without
      // needing a second row of text
      if (scale.lowIsBad) tone = pct <= 0.15 ? 'danger' : pct <= 0.35 ? 'warn' : 'accent'
    }
    out.push({ key, label: key, value: fmt(raw), pct, tone })
  }
  return out
}

/** A point on the 24-hour track, as the positions endpoint returns it. */
export interface TrackPoint {
  fixTime: string
  lat: number
  lon: number
  speed: number | null
  course: number | null
  ignition: boolean | null
  fixValid: boolean
}

/**
 * The selected device's last `hours` of history.
 *
 * Invalid fixes come back too and are filtered at the point of USE rather than here: invariant I6
 * says they must never affect the map, but they are still evidence — a stretch of `fixValid:false`
 * is exactly how "the tracker was reporting, it just could not see the sky" looks, and dropping it
 * silently would make that indistinguishable from a gap in reporting.
 */
/**
 * The endpoint's page cap. It orders `fix_time ASC`, so a limit BELOW the number of records in the
 * window returns the OLDEST ones — the first hour of the day, not the last. At 1000 that pinned
 * roughly 23/24 of the scrubber to a single point and flew the map to where the vehicle was at
 * 01:00, while the summary confidently reported "1000 points". The playback page, same endpoint and
 * same client, has always used the full page.
 */
const TRACK_LIMIT = 10_000

/**
 * The window is passed IN, not computed here.
 *
 * It used to call `new Date()` on every fetch while the scrubber's axis stayed frozen at selection
 * time, so the two drifted apart: after half an hour away, a refetch returned points newer than any
 * slider position could reach, the "-24 h" tick was really 24.5 h ago, and nudging the slider one
 * minute off "now" jumped the map half an hour into the past. Axis and payload must be the same
 * window, and the only way to guarantee that is to make it one value.
 */
export async function getTrack(deviceId: string, window: { from: number; to: number }): Promise<{ points: TrackPoint[]; truncated: boolean }> {
  const from = new Date(window.from)
  const to = new Date(window.to)
  const points = await getJson<TrackPoint[]>(
    `/v1/devices/${encodeURIComponent(deviceId)}/positions?from=${from.toISOString()}&to=${to.toISOString()}&limit=${TRACK_LIMIT}`,
  )
  // A full page means there is more history than we asked for, and what we hold is the OLDER part.
  // Saying so beats silently pinning the scrubber, which is indistinguishable from a parked vehicle.
  return { points, truncated: points.length >= TRACK_LIMIT }
}

/** Only the points the map may draw — invariant I6: an invalid fix never places anything. */
export const drawable = (points: readonly TrackPoint[]): TrackPoint[] => points.filter((p) => p.fixValid)

/**
 * The point the scrubber is pointing at: the newest one at or before `atMs`.
 *
 * Newest-at-or-before rather than nearest, because a track is a sequence of states — at 14:32 the
 * vehicle was wherever it last reported, not wherever it happens to report next.
 */
/**
 * Where the vehicle actually WAS at `atMs`: the newest point at or before it that had a fix.
 *
 * Distinct from `pointAt`, which answers "what did the tracker report" and may legitimately answer
 * with a no-fix record. This one answers "where do I put the camera", so invariant I6 applies: an
 * invalid record carries the last valid position by convention (spec §3.4) but is not itself a
 * place, and a moment before the window's first valid fix has no answer at all — `undefined` here
 * means "hold", never "fall back to live".
 */
export function placeAt(points: readonly TrackPoint[], atMs: number, times?: readonly number[]): TrackPoint | undefined {
  let place: TrackPoint | undefined
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const t = times?.[i] ?? Date.parse(p.fixTime)
    if (!Number.isFinite(t)) continue // one bad row must not truncate the scan
    if (t > atMs) break
    if (p.fixValid) place = p
  }
  return place
}

/**
 * The track's timestamps, parsed once.
 *
 * `Date.parse` is the expensive part of every scan, and a slider drag runs two scans per step over
 * up to 10 000 points — 20 000 parses per step, dozens of steps a second. Scanning the same count
 * of plain numbers is free by comparison. NaN is preserved rather than dropped, so the "skip a bad
 * row, never truncate" rule survives.
 */
export const trackTimes = (points: readonly TrackPoint[]): number[] => points.map((p) => Date.parse(p.fixTime))

export function pointAt(points: readonly TrackPoint[], atMs: number, times?: readonly number[]): TrackPoint | undefined {
  let found: TrackPoint | undefined
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const t = times?.[i] ?? Date.parse(p.fixTime)
    // skip, never break, on an unparseable timestamp: breaking cut the track at the bad row, so
    // every later moment froze on whatever preceded it
    if (!Number.isFinite(t)) continue
    if (t <= atMs) found = p
    else break
  }
  return found
}
