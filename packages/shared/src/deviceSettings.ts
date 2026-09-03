import catalogue from '../params/deviceParams.json' with { type: 'json' }

/**
 * Customer-editable tracking settings — the named, bounded view over Teltonika's raw parameter ids.
 *
 * Three rules shape this module, and all three were bought with hardware time on 2026-08-18.
 *
 * 1. A setting only exists for a model whose OWN wiki parameter list carries the id. The ids are
 *    not universal — 10051/10052 are absent on ATC700 and ATM700 — and naming an id a model does
 *    not implement risks the device rejecting the entire setparam.
 *
 * 2. Our bounds are NARROWER than the wiki's. Every period has a wiki minimum of 0, and 0 on a
 *    SEND period means "do not send": written to a live tracker it kept recording and went silent
 *    for an hour. (0 on a Min Period is different — it disables that one trigger and the others
 *    keep firing — but a slider whose left edge can silence a fleet is not a slider, so both floor
 *    at 2 s.) The ceiling is ours too: 2592000 s is a valid parameter and a useless product.
 *
 * 3. These are the HOME-network profile, and the UI must say so. A device whose current operator is
 *    not in its roaming list runs the roaming or unknown profile instead, and those ship with send
 *    period 0 on 80 of the 89 models we have pages for. A cross-border truck can therefore be set
 *    to "send every 2 s" through this catalogue while the profile it is actually using transmits
 *    nothing — the same silent-recording failure wearing a different hat. Exposing those profiles
 *    is a decision about who pays for roaming data, so this module records them and offers none.
 *    https://wiki.teltonika-gps.com/view/FMB120_Data_acquisition_settings
 */

export type SettingKey =
  | 'movingByTime'
  | 'movingByDistance'
  | 'movingByAngle'
  | 'movingSendPeriod'
  | 'parkedByTime'
  | 'parkedSendPeriod'

export type SettingUnit = 'seconds' | 'metres' | 'degrees'

export interface SettingDef {
  key: SettingKey
  /** Teltonika parameter id. The API returns it (support needs to correlate a slider with a
   *  setparam in the command log); the UI does not put it in front of a customer. */
  param: string
  unit: SettingUnit
  group: 'moving' | 'parked'
  /** Which network profile this id belongs to. Only `home` is offered — see rule 3 above. */
  profile: 'home'
}

/**
 * `movingBySpeed` (10053) is deliberately absent: FMB640, FMC650 and FMM650 label it "Seconds"
 * while the FT pages treat it as a speed delta, and a unit we cannot state from the source is a
 * unit we must not print under a customer's slider (CLAUDE.md rule 8).
 */
const DEFS: readonly SettingDef[] = [
  { key: 'movingSendPeriod', param: '10055', unit: 'seconds', group: 'moving', profile: 'home' },
  { key: 'movingByTime', param: '10050', unit: 'seconds', group: 'moving', profile: 'home' },
  { key: 'movingByDistance', param: '10051', unit: 'metres', group: 'moving', profile: 'home' },
  { key: 'movingByAngle', param: '10052', unit: 'degrees', group: 'moving', profile: 'home' },
  { key: 'parkedByTime', param: '10000', unit: 'seconds', group: 'parked', profile: 'home' },
  { key: 'parkedSendPeriod', param: '10005', unit: 'seconds', group: 'parked', profile: 'home' },
]

/** Our floor and ceiling per setting, before intersecting with the model's own bounds. */
const SAFE: Record<SettingKey, { min: number; max: number }> = {
  movingSendPeriod: { min: 2, max: 120 },
  movingByTime: { min: 2, max: 300 },
  movingByDistance: { min: 20, max: 1000 },
  movingByAngle: { min: 5, max: 90 },
  parkedByTime: { min: 300, max: 3600 },
  parkedSendPeriod: { min: 2, max: 3600 },
}

export interface AvailableSetting extends SettingDef {
  /** The bound we actually offer: our safe range ∩ the model's range. */
  min: number
  max: number
  /**
   * The device's factory value, from its own model page — CLAMPED into [min,max].
   *
   * FMB640, FMC650 and FMM650 state a factory `movingByTime` of 3600 s, well above our 300 s
   * ceiling. Returned unclamped it would seed a form with a value the slider cannot render and
   * `isSettingInRange` would reject, and a "reset to factory" button built on it would drop a live
   * truck from hourly to five-minute records — a 12× traffic increase nobody asked for.
   */
  factory: number
  /** True when the model's own factory value lies outside what we offer, so the UI can say so. */
  factoryOutOfRange: boolean
}

interface CatalogueParam { default: string; min: string; max: string; name: string; value: string }
interface CatalogueModel {
  sourceUrl: string
  params: Record<string, CatalogueParam>
  /** id → element name, present only on models whose wiki page carries an LVCAN/CAN block. */
  canElements?: Record<string, string>
}
const MODELS = (catalogue as { models: Record<string, CatalogueModel> }).models

/** `MODELS` is a plain object literal from JSON, so `settingsForModel('constructor')` would other-
 *  wise reach Object.prototype and throw a 500 out of a device record. */
const modelEntry = (model: string): CatalogueModel | undefined => {
  const key = model.trim()
  if (Object.hasOwn(MODELS, key)) return MODELS[key]
  const upper = key.toUpperCase()
  return Object.hasOwn(MODELS, upper) ? MODELS[upper] : undefined
}

/**
 * The settings offered for a model, or an empty list when we have no parameter list for it.
 *
 * Empty is a real answer and the UI must show it as one: 12 catalogued models have no parameter
 * page at all and the TAT asset-tracker family has no data-acquisition block, so inventing bounds
 * for them from a sibling model would be a guess wearing a slider.
 */
export function settingsForModel(model: string | null | undefined): AvailableSetting[] {
  if (typeof model !== 'string' || model.trim() === '') return []
  const entry = modelEntry(model)
  if (entry === undefined) return []
  const out: AvailableSetting[] = []
  for (const def of DEFS) {
    const range = entry.params[def.param]
    if (range === undefined) continue // the model does not implement it — never offer it
    const safe = SAFE[def.key]
    const min = Math.max(safe.min, Number(range.min))
    const max = Math.min(safe.max, Number(range.max))
    const raw = Number(range.default)
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || !Number.isFinite(raw)) continue
    out.push({
      ...def,
      min,
      max,
      factory: Math.min(max, Math.max(min, raw)),
      factoryOutOfRange: raw < min || raw > max,
    })
  }
  return out
}

/** Is `value` one this model will actually accept for `key`? Belongs on the API too, not only the UI. */
export function isSettingInRange(model: string | null | undefined, key: SettingKey, value: number): boolean {
  const s = settingsForModel(model).find((x) => x.key === key)
  if (s === undefined) return false
  return Number.isInteger(value) && value >= s.min && value <= s.max
}

// ── CAN (LVCAN / vehicle bus) elements ───────────────────────────────────────
/**
 * The vehicle-bus values a model can report, and the one parameter that decides whether it does.
 *
 * Why this exists: every CAN element on a Teltonika tracker ships with its priority parameter at 0,
 * which means "do not send". A customer can wire a working CAN bus, see the device online, and
 * still get the same ~6 GPS/IO elements a device with no bus at all produces — because nothing in
 * onboarding ever raised one of these. The dashboard then looks broken for a reason no amount of
 * re-checking the wiring can find.
 *
 * Each element occupies a SIX-id block on the model's parameter page — priority, then the
 * operand/high/low/event-only/avg-const quartet that shapes an event — and the FIRST id of the
 * block is the priority: 0 = not sent, 1 = low, 2 = high, 3 = panic. This module offers ONLY that
 * first id. The other five configure event generation, which is a different feature with different
 * bounds, and writing one by accident while trying to turn a value on would arm an alert nobody
 * asked for. https://wiki.teltonika-gps.com/view/FMC150_Parameter_list (LVCAN section)
 *
 * The ids are per MODEL, taken from that model's own page, exactly as `settingsForModel` takes
 * ranges: 39 of the 105 models we hold pages for have a CAN block and 66 do not, and an id a model
 * does not implement must never be sent to it.
 */
export interface CanElementDef {
  /** Teltonika parameter id — the element's PRIORITY parameter (first id of its 6-id block). */
  param: string
  /** The element's name from the model's own parameter page, e.g. "Vehicle Speed". */
  name: string
}

/** Priority values the priority parameter accepts. 0 is the shipped default and means "not sent". */
export const CAN_PRIORITY_MIN = 0
export const CAN_PRIORITY_MAX = 3

/** Is `value` a priority this parameter accepts? Fixed by the protocol, so not per-model. */
export const isCanPriority = (value: number): boolean =>
  Number.isInteger(value) && value >= CAN_PRIORITY_MIN && value <= CAN_PRIORITY_MAX

/**
 * The CAN elements a model can report, or an empty list when its page has no CAN block.
 *
 * Empty means "this model has no vehicle-bus support we can cite", NOT "everything is switched
 * off" — the API says which of those it is, because they call for opposite actions from the person
 * reading the screen.
 */
export function canElementsForModel(model: string | null | undefined): CanElementDef[] {
  if (typeof model !== 'string' || model.trim() === '') return []
  const elements = modelEntry(model)?.canElements
  if (elements === undefined) return []
  return Object.entries(elements)
    .map(([param, name]) => ({ param, name }))
    // by id, which is the order the wiki page lists them in — the UI shows the page's own grouping
    .sort((a, b) => Number(a.param) - Number(b.param))
}

/** Does THIS model carry this CAN priority parameter? The write path's membership gate. */
export function isCanElementOfModel(model: string | null | undefined, param: string): boolean {
  if (typeof model !== 'string' || model.trim() === '') return false
  const elements = modelEntry(model)?.canElements
  // `canElements` is a plain object from JSON: `Object.hasOwn`, never `in`, or 'constructor' passes.
  return elements !== undefined && Object.hasOwn(elements, param)
}

/**
 * Mobile data a tracking configuration costs the CUSTOMER, so the UI can state it before they drag
 * a slider rather than after they read a bill.
 *
 * The rate is driven by ALL the record triggers, not just the time one. Teltonika is explicit that
 * they run concurrently — "able to collect records using four methods at the same time: time,
 * distance, angle, and speed-based" — so at 50 km/h the 20 m distance floor alone produces a record
 * every 1.4 s no matter what the time period says. Keying the estimate on `movingByTime` alone
 * understated a realistic configuration by two orders of magnitude.
 * https://wiki.teltonika-gps.com/view/FMB120_Data_acquisition_settings
 *
 * Bytes are counted from the wire, not guessed. A Codec 8 Extended record is 8 B timestamp +
 * 1 priority + 15 GPS + a 14 B IO header (event id, total count, and a 2-byte count per size group)
 * + the elements; the FTC887 sends about eleven, so ~84 B. A frame adds 15 B (preamble, length,
 * codec, counts, CRC) and each TCP segment ~40 B of IP+TCP header. The server's 4-byte record-count
 * ACK is unconditional (CLAUDE.md rule 4) and rides its own segment, and the device acknowledges
 * that — so a send costs 15 + 40 uplink and 44 + 40 downlink. M2M plans bill both directions.
 *
 * Still a floor: it ignores retransmissions, the GPRS attach and any keepalive.
 */
const RECORD_BYTES = 84
const SEND_OVERHEAD_BYTES = 15 + 40 + 44 + 40

/** The angle trigger fires on turns, which no formula can predict; this is the straight-road rate. */
export function recordsPerHour(
  opts: { byTimeSeconds?: number; byDistanceMetres?: number; avgSpeedKmh?: number },
): number {
  const { byTimeSeconds, byDistanceMetres, avgSpeedKmh = 50 } = opts
  const rates: number[] = []
  if (Number.isFinite(byTimeSeconds) && (byTimeSeconds ?? 0) > 0) rates.push(3600 / byTimeSeconds!)
  if (Number.isFinite(byDistanceMetres) && (byDistanceMetres ?? 0) > 0 && avgSpeedKmh > 0) {
    rates.push((avgSpeedKmh * 1000) / byDistanceMetres!)
  }
  if (rates.length === 0) return 0
  // concurrent triggers ⇒ the fastest one sets the pace, and the GNSS receiver samples at 1 Hz, so
  // nothing can produce more than 3600 records an hour however the sliders are dragged
  return Math.min(3600, Math.max(...rates))
}

export function estimateDataBytesPerHour(opts: {
  byTimeSeconds?: number
  byDistanceMetres?: number
  avgSpeedKmh?: number
  sendEverySeconds: number
}): number {
  const { sendEverySeconds } = opts
  if (!Number.isFinite(sendEverySeconds) || sendEverySeconds <= 0) return 0
  const perHour = recordsPerHour(opts)
  if (perHour <= 0) return 0
  // a send carries whatever accumulated since the last one, and never fewer than one record
  const recordsPerSend = Math.max(1, (perHour / 3600) * sendEverySeconds)
  const sendsPerHour = perHour / recordsPerSend
  return perHour * RECORD_BYTES + sendsPerHour * SEND_OVERHEAD_BYTES
}

/** What the UI quotes: megabytes for a day's driving, and for a 22-day working month. */
export function estimateDataUsage(
  opts: { byTimeSeconds?: number; byDistanceMetres?: number; avgSpeedKmh?: number; sendEverySeconds: number },
  drivingHoursPerDay = 8,
): { perDrivingDayMB: number; perMonthMB: number } {
  const hours = Number.isFinite(drivingHoursPerDay) && drivingHoursPerDay > 0 ? drivingHoursPerDay : 0
  const day = (estimateDataBytesPerHour(opts) * hours) / 1_000_000
  return { perDrivingDayMB: round2(day), perMonthMB: round2(day * 22) }
}

const round2 = (n: number): number => Math.round(n * 100) / 100
