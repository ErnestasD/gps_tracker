import type { NormalizedRecord } from '@orbetra/shared'

/**
 * Semantic IO accessors for the rule engine (E05-4). normalize.ts promotes only three
 * AVL ids to typed columns (ignition/movement/odometer); everything else lands in
 * `attrs`, keyed by the dictionary NAME (with an `io_<id>` fallback on name collision,
 * see normalize.ts §3.7). Two dictionary rows share the name "Battery Voltage" — id 67
 * (multiplier 0.001, units V) and id 168 (no multiplier) — so the name key is ambiguous
 * depending on packet order. We read `io_67` FIRST (present only when the name was taken
 * by the OTHER id) and fall back to the name, which deterministically resolves id 67 in
 * the common case (67 alone) AND when both are present. LIMITATION: a device that emits
 * ONLY id 168 would be read under the name and scaled ×0.001 — out of scope for v1 (FMB120
 * sends id 67); flagged for the promote-to-column ADR if a 168-only model appears.
 *
 * All AVL ids cited from packages/codec/dictionaries/fmb1xx.json (wiki FMB120 table):
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 */

// AVL ids (fmb1xx dictionary)
export const AVL_DIN1 = 1 // "Digital Input 1" — Logic 0/1
export const AVL_BATTERY_VOLTAGE = 67 // "Battery Voltage" — multiplier 0.001 (mV → V)
export const AVL_ALARM = 236 // "Alarm" — 0: Reserved, 1: Alarm event occurred
export const AVL_UNPLUG = 252 // "Unplug" — 0: battery present, 1: battery unplugged

/** Battery Voltage multiplier from the dictionary (0.001): normalize stores the RAW
 * integer (mV), so the engine scales to volts here. Standard across FMB/FMC/TAT families. */
const BATTERY_VOLTAGE_MULTIPLIER = 0.001

/** Read an AVL id's value regardless of whether it kept the dictionary name or fell back
 * to `io_<id>` on collision (see file header). Returns a finite number or null. */
function attrNumber(attrs: Record<string, unknown>, id: number, name: string): number | null {
  const raw = attrs[`io_${id}`] ?? attrs[name]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** Ignition (AVL 239) — promoted to a column by normalize. */
export function ignitionOf(r: NormalizedRecord): boolean | null {
  return r.ignition
}

/** Digital Input 1 (AVL 1) as a boolean (0/1). */
export function din1Of(r: NormalizedRecord): boolean | null {
  const v = attrNumber(r.attrs, AVL_DIN1, 'Digital Input 1')
  return v === null ? null : v !== 0
}

/** Unplug (AVL 252): true ⇒ battery unplugged (external power cut). */
export function unplugOf(r: NormalizedRecord): boolean | null {
  const v = attrNumber(r.attrs, AVL_UNPLUG, 'Unplug')
  return v === null ? null : v !== 0
}

/** Alarm (AVL 236): true ⇒ alarm/panic event occurred. */
export function alarmOf(r: NormalizedRecord): boolean | null {
  const v = attrNumber(r.attrs, AVL_ALARM, 'Alarm')
  return v === null ? null : v !== 0
}

/** Battery Voltage (AVL 67) in VOLTS (raw mV × 0.001). */
export function batteryVoltsOf(r: NormalizedRecord): number | null {
  const mv = attrNumber(r.attrs, AVL_BATTERY_VOLTAGE, 'Battery Voltage')
  return mv === null ? null : mv * BATTERY_VOLTAGE_MULTIPLIER
}
