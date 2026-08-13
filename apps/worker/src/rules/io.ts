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
 * All AVL ids cited from packages/codec/dictionaries/fmb120.json (wiki FMB120 table):
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 *
 * AND THAT CITATION IS NOW A LIMITATION, not just provenance. Since the device profile selects the
 * dictionary, `attrs` keys are a PER-MODEL vocabulary and these accessors still speak only FMB120's.
 * Measured across the 34 shipped tables, id 236 is "Alarm" on 16, "Alarm button" on atc700 and
 * "Axis X" on the six FMx6xx tables; id 252 is "Unplug" on 15, "Unplug detection" on the 11
 * FTC/ATC tables and "Authorized Driving" on the FMx6xx ones. So a panic or power-cut rule created
 * against an FMC650 cannot fire — and BEFORE the profile chose a dictionary the same device decoded
 * as FMB120 and fired the panic rule off its accelerometer instead, which is the worse of the two.
 * Neither is right. The fix is a per-table semantic index (which id, if any, carries "alarm" on
 * THIS model) plus gating rule creation on the model actually having the parameter — the same work
 * as the dictionary-driven read path, tracked in the README's known-gap note. Recorded here rather
 * than left for the next reader to rediscover from a customer's support ticket.
 */

// AVL ids (fmb1xx dictionary)
export const AVL_DIN1 = 1 // "Digital Input 1" — Logic 0/1
export const AVL_BATTERY_VOLTAGE = 67 // "Battery Voltage" — multiplier 0.001 (mV → V)
export const AVL_ALARM = 236 // "Alarm" — 0: Reserved, 1: Alarm event occurred
export const AVL_UNPLUG = 252 // "Unplug" — 0: battery present, 1: battery unplugged
// Fuel level ids share the ambiguous name "Fuel Level", so normalize FORCES io_<id> keys (E08-3):
// io_89 Fuel level %, io_48 OBD Fuel Level %, io_84 Fuel level l (wiki multiplier ×0.1).
const FUEL_LITERS_MULTIPLIER = 0.1

/** Battery Voltage multiplier from the dictionary (0.001): normalize stores the RAW
 * integer (mV), so the engine scales to volts here. Standard across FMB/FMC/TAT families. */
const BATTERY_VOLTAGE_MULTIPLIER = 0.001

/**
 * Read an AVL id's value regardless of whether it kept the dictionary name or fell back to
 * `io_<id>` on collision (see file header). Returns a finite number or null.
 *
 * TAKES EVERY SPELLING, because the attrs key is the DEVICE'S OWN table's name. Where the wiki
 * types one parameter several ways this is a pure lookup problem with no semantics in it — id 252
 * is "Unplug" on 15 tables and "Unplug detection" on 11, and reading only the first meant a trailer
 * fleet on ATC/FTC hardware could create a power-cut rule the API accepted and that never fired
 * when the tracker was ripped out. Spellings that mean something ELSE are simply not listed, so an
 * FMx6xx (where 252 is "Authorized Driving" — "Authorized driving" on fm36, lower-case d — and 236
 * is "Axis X") matches nothing and the rule stays silent rather than firing off an accelerometer.
 * See the header note.
 */
function attrNumber(attrs: Record<string, unknown>, id: number, ...names: string[]): number | null {
  let raw = attrs[`io_${id}`]
  for (const n of names) raw ??= attrs[n]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** Ignition (AVL 239) — promoted to a column by normalize. */
export function ignitionOf(r: NormalizedRecord): boolean | null {
  return r.ignition
}

/** Digital Input 1 (AVL 1) as a boolean (0/1). */
export function din1Of(r: NormalizedRecord): boolean | null {
  const v = attrNumber(r.attrs, AVL_DIN1, 'Digital Input 1', 'Digital Input Status 1')
  return v === null ? null : v !== 0
}

/** Unplug (AVL 252): true ⇒ battery unplugged (external power cut). */
export function unplugOf(r: NormalizedRecord): boolean | null {
  const v = attrNumber(r.attrs, AVL_UNPLUG, 'Unplug', 'Unplug detection')
  return v === null ? null : v !== 0
}

/** Alarm (AVL 236): true ⇒ alarm/panic event occurred. */
export function alarmOf(r: NormalizedRecord): boolean | null {
  const v = attrNumber(r.attrs, AVL_ALARM, 'Alarm', 'Alarm button')
  return v === null ? null : v !== 0
}

/** Battery Voltage (AVL 67) in VOLTS (raw mV × 0.001). */
export function batteryVoltsOf(r: NormalizedRecord): number | null {
  const mv = attrNumber(r.attrs, AVL_BATTERY_VOLTAGE, 'Battery Voltage')
  return mv === null ? null : mv * BATTERY_VOLTAGE_MULTIPLIER
}

/** Read a fuel id's value from its FORCED io_<id> key only (the shared name is ambiguous). */
function fuelIo(attrs: Record<string, unknown>, id: number): number | null {
  const raw = attrs[`io_${id}`]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/**
 * Fuel level as { pct, liters } (E08-3 semantics): pct from io_89 (fallback io_48, both %, no
 * multiplier); liters from io_84 (wiki ×0.1). Either may be null if the model omits it.
 *
 * KNOWN LIMITATION, one model. `fm36` (FM36/FM3612/FM36M1) is the only table in the corpus where
 * AVL 89 carries a multiplier — 0.1 — so its percentage arrives here ten times too large, and
 * `fuel_theft` compares percentage-POINT thresholds, which makes a rule set to "alert on a 15 %
 * drop" fire on a real 1.5-point change. The READ path is fixed (packages/db/src/fuel.ts scales by
 * the device's table), but this accessor is handed a NormalizedRecord, which does not carry the
 * table — closing it properly means threading the dictionary into the rule engine, which is the
 * same work as the read-path semantic index the README already tracks. Recorded here so the next
 * reader does not rediscover it from a customer's false theft alert.
 */
export function fuelLevelOf(r: NormalizedRecord): { pct: number | null; liters: number | null } {
  const pct = fuelIo(r.attrs, 89) ?? fuelIo(r.attrs, 48)
  const l84 = fuelIo(r.attrs, 84)
  return { pct, liters: l84 === null ? null : l84 * FUEL_LITERS_MULTIPLIER }
}
