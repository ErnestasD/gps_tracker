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
export async function getTrack(deviceId: string, hours = 24): Promise<TrackPoint[]> {
  const to = new Date()
  const from = new Date(to.getTime() - hours * 3_600_000)
  return getJson<TrackPoint[]>(
    `/v1/devices/${encodeURIComponent(deviceId)}/positions?from=${from.toISOString()}&to=${to.toISOString()}&limit=1000`,
  )
}

/** Only the points the map may draw — invariant I6: an invalid fix never places anything. */
export const drawable = (points: readonly TrackPoint[]): TrackPoint[] => points.filter((p) => p.fixValid)

/**
 * The point the scrubber is pointing at: the newest one at or before `atMs`.
 *
 * Newest-at-or-before rather than nearest, because a track is a sequence of states — at 14:32 the
 * vehicle was wherever it last reported, not wherever it happens to report next.
 */
export function pointAt(points: readonly TrackPoint[], atMs: number): TrackPoint | undefined {
  let found: TrackPoint | undefined
  for (const p of points) {
    if (Date.parse(p.fixTime) <= atMs) found = p
    else break
  }
  return found
}
