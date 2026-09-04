import { isNullIsland } from '@orbetra/shared'

import { getJson } from './client'
import { pairedTimes } from './trackWindow'

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
  /**
   * `io_<id>` key → what that element is on THIS device's AVL table.
   *
   * The pipeline keeps an id-key whenever the name is ambiguous within the table (48/84/89 are all
   * "Fuel Level"), which is right for storage and unreadable on screen. The SERVER resolves them,
   * because the same id is a fuel level on one table and an axle weight on another — a browser-side
   * id map would be a guess about the vehicle. Absent against an API older than this deploy.
   */
  attrLabels?: Record<string, AttrLabel>
}

/** A dictionary entry as the telemetry endpoint sends it. */
export interface AttrLabel {
  name: string
  units?: string
  /** Already a number: the server parses the wiki's cell (two decimal conventions, 29% non-numeric)
   *  in ONE place and omits the field rather than sending something the browser must guess at. */
  multiplier?: number
  /** The wiki's "Parameter Group" cell verbatim, e.g. "CAN Chip", "Permanent I/O elements". */
  group?: string
  /** The wiki's "Max" cell verbatim — identifies a documented bitmask; see `DOOR_BITMASK_MAX`. */
  max?: string
}

/**
 * Which side of the list an element belongs on: what the VEHICLE reports, or what the TRACKER does.
 *
 * Decided from Teltonika's own "Parameter Group" column rather than from the element names, because
 * the names are not a classification and we would be maintaining a keyword list against several
 * thousand of them.
 *
 * The word boundaries matter: `Euroscan IO` and `Transcan IO` both contain the letters "can" and
 * are neither — they are trailer refrigeration recorders, cargo equipment rather than the vehicle.
 * `ALLCAN300`, `LVCAN200` and `CANCONTROL` are Teltonika's CAN adapters and are matched by name.
 * Beyond the car buses, the truck ones are here too (tachograph, FMS, J1939, ISOBUS, TPMS): the
 * founder asked for one consistent order across every vehicle, not only the ones on OBD.
 */
const VEHICLE_GROUP =
  /(^|[^a-z])(can|obd|tacho\w*|fms|j1939|isobus|tpms)([^a-z]|$)|allcan|lvcan|cancontrol|tachograph/i

export type TelemetrySection = 'vehicle' | 'device'

/** An element with no group cell stays with the tracker's own readings — the conservative side:
 *  it keeps an unclassified element visible in the place the list has always shown it. */
const sectionOf = (label: AttrLabel | undefined): TelemetrySection =>
  label?.group !== undefined && VEHICLE_GROUP.test(label.group) ? 'vehicle' : 'device'

/**
 * "Door Status" is a bitmask, and an operator reads open/closed — not 256.
 *
 * Teltonika documents six openings in one 2-byte value (0 = everything closed, 0x3F00 = everything
 * open). The founder needs the four DOORS as one state and the boot as its own, so the single
 * element is expanded into separate rows rather than shown as a decimal an operator has to convert.
 * The engine cover gets its own row for the same reason: folding it into "doors" would make an open
 * bonnet raise a doors-open alert, and folding it into the boot would name it wrongly.
 *
 * Gated on the wiki's own MAX cell, never on the name: `Door Status` is this bitmask on fmc150 (id
 * 90, 2 bytes, max 16128) and a 1-byte Reefer IO element on fmb640 (id 10355, max 255), where these
 * bits mean nothing. An entry that does not declare the documented ceiling is left as a number.
 * https://wiki.teltonika-gps.com/view/FMC150_Teltonika_Data_Sending_Parameters_ID
 */
const DOOR_BITMASK_MAX = '16128' // 0x3F00 — bits 8..13, the six documented openings
const DOOR_PARTS = [
  { labelKey: 'doors', mask: 0x0f00 }, // 0x100 front-left, 0x200 front-right, 0x400/0x800 rear
  { labelKey: 'trunk', mask: 0x2000 },
  { labelKey: 'hood', mask: 0x1000 },
] as const

const isDoorBitmask = (label: AttrLabel | undefined): boolean =>
  label !== undefined && label.name.trim().toLowerCase() === 'door status' && label.max === DOOR_BITMASK_MAX

export const getTelemetry = (deviceId: string, at?: string | null) =>
  getJson<LatestTelemetry | { empty: true }>(
    `/v1/devices/${encodeURIComponent(deviceId)}/telemetry${at != null ? `?at=${encodeURIComponent(at)}` : ''}`,
  )

export const hasTelemetry = (t: LatestTelemetry | { empty: true } | undefined): t is LatestTelemetry =>
  t !== undefined && !('empty' in t)

/** One row of the parameters list. `documented` is false for a bare `io_<id>` the model's own
 *  wiki page does not name — worth showing as such rather than hiding. */
export interface TelemetryRow {
  key: string
  label: string
  value: string
  documented: boolean
  /** What the vehicle reports leads; what the tracker reports about itself follows. */
  section: TelemetrySection
  /**
   * Set on a row decoded to a state rather than a number (the door bitmask). The words are the
   * CALLER's: this module has no translator, and "open"/"closed" is the one thing here that must
   * be read in the operator's own language.
   */
  binary?: { labelKey: (typeof DOOR_PARTS)[number]['labelKey']; open: boolean }
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
 * Known element names (dictionary spelling, lower-cased) → human units. The raw values are
 * device units per Teltonika's data-sending tables — External/Battery Voltage in mV, Battery
 * Current in mA, the mileage/odometer family in metres
 * (https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID) — and
 * showing "12787" where an operator reads volts is noise (founder, 2026-08-20). Matched on
 * the dictionary NAME, never a raw AVL id: the same id means different things across tables,
 * so an `io_<id>` row stays raw on purpose — we don't know its unit.
 */
const toKm = (m: number): string => `${(m / 1000).toFixed(2)} km`
const NAMED_UNITS: Record<string, (v: number) => string> = {
  'external voltage': (v) => `${(v / 1000).toFixed(1)} V`,
  'battery voltage': (v) => `${(v / 1000).toFixed(2)} V`,
  'battery current': (v) => `${v} mA`,
  'total mileage': toKm,
  'total mileage (counted)': toKm,
  'total odometer': toKm,
  'trip odometer': toKm,
  'coolant temperature': (v) => `${v} °C`,
  'engine rpm': (v) => `${v} rpm`,
  'battery level': (v) => `${v} %`, // AVL 113 is a percentage on every table
  // 'fuel level' is deliberately ABSENT: AVL 84 reports litres on some CAN adapters, so a
  // "%" suffix would be a claim about the vehicle (see telemetry.spec's out-of-range case)
}

/** Value formatter that knows the element's unit when the NAME is a documented one. */
export const fmtAttrValue = (key: string, v: unknown, label?: AttrLabel): string => {
  if (typeof v === 'number') {
    /**
     * The DICTIONARY wins over this file's name table, for named elements as well as id-keys: the
     * entry carries the wiki's own multiplier and units. AVL 84 (×0.1, litres) reads "18.0 l"
     * rather than "180", and `Engine Total Hours (counted)` reads "47 min" rather than a bare "47"
     * that every reader takes for hours. NAMED_UNITS below is now only the fallback for an API
     * older than this deploy, which sends no labels at all.
     */
    if (label !== undefined) {
      const mult = label.multiplier ?? 1
      const scaled = mult !== 1 ? v * mult : v
      /**
       * Metres are the wiki's unit and nobody's reading unit: every element this table declares in
       * metres is an odometer (87 Total Mileage, 105 counted, 199 Trip Odometer, the two tachograph
       * distances), and "362730000 m" is a number a person has to count digits in. The dictionary
       * decides the SCALE; this decides how a human reads it.
       */
      if (label.units === 'm') return `${(scaled / 1000).toFixed(2)} km`
      // a multiplied value is fractional by construction; an unmultiplied one is shown as sent
      const shown = mult !== 1 ? scaled.toFixed(1) : String(scaled)
      return label.units === undefined ? shown : `${shown} ${label.units}`
    }
    const unit = NAMED_UNITS[key.toLowerCase()]
    if (unit !== undefined) return unit(v)
  }
  return fmt(v)
}

/**
 * The device's own parameters, sorted so the named ones lead.
 *
 * An `io_<id>` key means the pipeline could not name the element from this model's dictionary —
 * either the wiki page is incomplete for that model, or the name was ambiguous within the table and
 * the id was kept deliberately. Both are worth seeing.
 */
/**
 * The element name as a reader should see it.
 *
 * Teltonika spells one concept two ways in the same table — `Engine Total Hours (counted)` next to
 * `Fuel Consumed Counted` — and side by side in one list that reads as two different kinds of
 * thing. The dictionary keeps their spelling untouched (it is the authority, and the string people
 * search the wiki with); only this label is normalised. The unit is appended because the raw name
 * hides it: "Engine Total Hours" is reported in MINUTES.
 */
function displayName(label: AttrLabel): string {
  const name = label.name.replace(/\s*\(?counted\)?$/i, ' (counted)')
  return label.units === undefined ? name : `${name} (${label.units})`
}

export function telemetryRows(
  attrs: Record<string, unknown>,
  labels: Record<string, AttrLabel> = {},
): TelemetryRow[] {
  const rows = Object.entries(attrs).flatMap<TelemetryRow>(([key, value]) => {
    const raw = /^io_(\d+)$/.exec(key)
    const label = labels[key]
    const section = sectionOf(label)
    // one bitmask, three states an operator actually reads — see DOOR_PARTS
    if (isDoorBitmask(label) && typeof value === 'number') {
      return DOOR_PARTS.map((part) => ({
        key: `${key}#${part.labelKey}`,
        label: part.labelKey,
        value: String((value & part.mask) !== 0),
        documented: true,
        section,
        binary: { labelKey: part.labelKey, open: (value & part.mask) !== 0 },
      }))
    }
    // "Fuel Level (l)" and "Fuel Level (%)" are two rows of the same name — the unit is the
    // whole point of keeping them apart, so it belongs in the label, not only in the value
    const named = label === undefined ? undefined : displayName(label)
    return [
      {
        key,
        label: named ?? (raw !== null ? `AVL ${raw[1]}` : key),
        value: fmtAttrValue(key, value, label),
        // an id-key we can name is not an undocumented element; only an unnamed one is
        documented: raw === null || label !== undefined,
        section,
      },
    ]
  })
  /**
   * Vehicle before device, then named before unnamed, then alphabetically. The founder reads fuel
   * and doors first and the tracker's own supply voltage second — the previous list interleaved
   * them by name alone, so "Battery Voltage" sat above "Fuel Level" for no reason a reader could see.
   */
  return rows.sort((a, b) => {
    if (a.section !== b.section) return a.section === 'vehicle' ? -1 : 1
    if (a.documented !== b.documented) return a.documented ? -1 : 1
    return a.label.localeCompare(b.label, undefined, { numeric: true })
  })
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

export function highlightRows(
  attrs: Record<string, unknown>,
  labels: Record<string, AttrLabel> = {},
): HighlightRow[] {
  /**
   * Candidates are keyed by the element's NAME, which for an id-key comes from the server's
   * dictionary lookup. That is what puts fuel back on this list at all: the pipeline stores it as
   * `io_84` / `io_89`, so a name-matched highlight list never saw it and an operator with a working
   * CAN bus read no fuel gauge.
   */
  const candidates = Object.keys(attrs).map((key) => {
    const label = labels[key]
    return { key, name: (label?.name ?? key).toLowerCase(), label }
  })
  const out: HighlightRow[] = []
  for (const wanted of HIGHLIGHT_ORDER) {
    // ALL matches, not the first: litres and percent are two readings of the same tank and the
    // founder asked for both — they differ only by unit, which the label carries
    for (const cand of candidates.filter((c) => c.name === wanted)) {
      const raw = attrs[cand.key]
      const scale = SCALES[wanted]
      const units = cand.label?.units
      let pct: number | null = null
      let tone: HighlightRow['tone'] = 'accent'
      /**
       * A bar needs a maximum, and only a percentage has one we did not invent. Litres do not:
       * this code cannot know the tank's size, and a bar drawn against 100 would say a full 18 l
       * tank is 18 % — a claim about the vehicle. Those rows show the value alone.
       */
      const scalable = scale !== undefined && (units === undefined || units === '%')
      if (scalable && typeof raw === 'number' && raw >= 0 && raw <= scale.max) {
        pct = raw / scale.max
        // a low signal or an empty tank is the thing worth noticing; the tone says so without
        // needing a second row of text
        if (scale.lowIsBad) tone = pct <= 0.15 ? 'danger' : pct <= 0.35 ? 'warn' : 'accent'
      }
      out.push({
        key: cand.key,
        label: cand.label === undefined ? cand.key : displayName(cand.label),
        value: fmtAttrValue(cand.key, raw, cand.label),
        pct,
        tone,
      })
    }
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
  /**
   * AVL 240 — the device's own "am I moving", independent of GNSS speed. Null when unreported, and
   * `undefined` in practice against an API older than this deploy (this response is an unchecked
   * cast, and a rolling deploy or a pinned white-label image can serve the older shape). Every
   * reader treats anything that is not an explicit `false` as "no statement".
   * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
   */
  movement: boolean | null
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

/**
 * Only the points the map may draw — invariant I6: an invalid fix never places anything.
 *
 * `fixValid` plus a null-island check, because the pipeline once said `true` for 0/0 with 37
 * satellites and the vehicle appeared in the Gulf of Guinea. Fixed at the source, kept here because
 * the stored rows outlive the fix.
 */
export const placeableFix = (p: { lat: number; lon: number; fixValid: boolean }): boolean =>
  p.fixValid && !isNullIsland(p.lat, p.lon)

export const drawable = (points: readonly TrackPoint[]): TrackPoint[] => points.filter(placeableFix)

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
  const ts = pairedTimes(points, times)
  let place: TrackPoint | undefined
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const t = ts?.[i] ?? Date.parse(p.fixTime)
    if (!Number.isFinite(t)) continue // one bad row must not truncate the scan
    if (t > atMs) break
    if (placeableFix(p)) place = p
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
  const ts = pairedTimes(points, times)
  let found: TrackPoint | undefined
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const t = ts?.[i] ?? Date.parse(p.fixTime)
    // skip, never break, on an unparseable timestamp: breaking cut the track at the bad row, so
    // every later moment froze on whatever preceded it
    if (!Number.isFinite(t)) continue
    if (t <= atMs) found = p
    else break
  }
  return found
}
