/**
 * Per-element corrections applied while generating the AVL dictionaries.
 *
 * WHY THIS FILE EXISTS. Teltonika's **Multiplier** column means two opposite things depending on the
 * row, and nothing in the data distinguishes them:
 *
 *   * on some rows `raw × multiplier` LANDS IN the unit named in the Units cell — id 10879 is
 *     `raw × 50` millivolts, so the Units cell describes the result;
 *   * on others the multiplier CONVERTS AWAY from it — id 67 is `raw × 0.001` **volts**, so the
 *     Units cell describes the raw wire value and nothing describes the result.
 *
 * The display layer multiplies and then applies its own SI rescale keyed on the Units cell, so every
 * "converts away" row is divided by a thousand twice: a healthy 12.6 V backup battery renders
 * `0.0 V` — the exact reading of dead hardware — beside a health chart showing 12.6 V from the same
 * number. The premise that shipped it is written down at telemetry.ts: "mV is a thousandth of a volt
 * on every table in the world, so scaling it needs no knowledge of the element." True of the UNIT.
 * False of this CELL.
 *
 * THE PROOF THAT NEEDS NO WIKI. Id 67 "Battery Voltage" carries multiplier `0,001` on six of our own
 * generated dictionaries. `fmc650.json` says `units: "V"`; `fmm650`, `fmc640`, `fmb641`, `fmb640` and
 * `fm6300` say `"mV"` — same element, same multiplier, same FMX6XX silicon. Today the identical raw
 * value renders 12.6 V on an FMC650 and 0.0 V on an FMM650, side by side in one product. That is not
 * an inference about a vendor's intent; it is a contradiction inside this repository, and only one
 * of the two readings produces a voltage a battery can have.
 *
 * WHAT A CORRECTION IS, AND IS NOT. `units` stays VERBATIM — it is provenance, and answers "what did
 * the wiki say?". `unitAfterMultiplier` is derived and answers "what is `raw × multiplier` measured
 * in?". Only the second is ever arithmetic input. Every entry here carries the reason and the source
 * that settles it, because a correction without a citation is a guess with better formatting
 * (CLAUDE.md rule 8).
 *
 * KEYED ON (table, id), NEVER ON id ALONE. Ids collide across families, and not merely between two
 * measurements: **id 327 is "UL202-02 Sensor Fuel level" on the FMB1XX tables and "Geofence zone 21"
 * on the FMX6XX ones**; 224 and 225 are ultrasonic fuel levels on one family and geofence zones 43
 * and 44 on the other. A correction keyed on the id would have given a geofence flag a unit in
 * millimetres.
 *
 * Full working, per element, with citations and worked examples: docs/protocols/multiplier-units.md.
 */

/** What `raw × multiplier` is measured in — the only question this file answers. */
export type Landing =
  /** the Units cell named the unit of the RAW value; `raw × multiplier` is in `unit` */
  | { kind: 'converts-to'; unit: string }
  /** the Units cell already describes the RESULT, so the display's own SI rescale is correct */
  | { kind: 'stated' }
  /** undecidable from the sources; claim nothing and show the number exactly as the device sent it */
  | { kind: 'refuse' }

export interface Correction {
  /**
   * Short, stable name for the DECISION — the four rules below, not four hundred rows.
   *
   * It is what the generated file carries, so a reader of a dictionary can find the argument here
   * instead of the argument being copied into every row that shares it. 57 copies of four
   * paragraphs was 24 KB of prose in the artifact — fourteen times the field it explained — and it
   * embedded internal repository paths in a file that ships inside a white-label product.
   */
  rule: string
  landing: Landing
  /** why this row is what it is, in one sentence a reviewer can check. Source-only, never shipped. */
  reason: string
  /** where it was settled: a bare wiki URL, so the artifact can carry it and satisfy rule 8 */
  source: string
}

const WIKI = 'https://wiki.teltonika-gps.com/view'

/**
 * Analog Input 1 (id 9) and Analog Input 2 (id 6) on the six pages that write `mV`.
 *
 * NINE sibling pages publish the byte-identical row (2 | Unsigned | 0 | 65535 | 0.001) as `V` — 25
 * tables publish id 9 as `V` in some width, but ten of those declare it four bytes and six more use
 * a 0–30000 range, so only nine are the same row. Stronger, and on the page itself: ids 66/67 carry
 * that exact geometry on each of these six pages and are published as `V` there, so `× 0.001`
 * demonstrably lands in volts without leaving the page. The analog input is **0–30 V DC** on both
 * channels wherever these models document one, and a literal mV reading tops out at 65.535 mV —
 * 0.22% of that range. Traccar reads id 9 as `readUnsignedShort() / 1000.0`.
 *
 * Two honest caveats. Traccar registers no handler for id 6 (its adc2 is id 10), so id 6 rests on
 * the wiki rows and the cross-model majority rather than on the oracle. And FMB010 and FMM80A
 * document no analog input at all while their tables still carry the rows: the correction applies
 * if one ever arrives, and claims nothing about their hardware.
 *
 * Range citation: https://wiki.teltonika-gps.com/view/FMB150_First_Start
 * ("Analog input, channel 1. Input range: 0-30 V DC.")
 */
const ANALOG_INPUT: Correction = {
  rule: 'ANALOG_INPUT',
  landing: { kind: 'converts-to', unit: 'V' },
  reason:
    'the Units cell names the RAW millivolt count; × 0.001 lands in volts. Same-page ids 66/67 carry ' +
    'the identical geometry and are published as V, nine sibling pages publish the byte-identical ' +
    'row as V, and the input is 0-30 V DC — a literal mV reading would top out at 65.535 mV, 0.22% ' +
    'of its range. Traccar reads id 9 as readUnsignedShort() / 1000.0.',
  source: `${WIKI}/FMB150_Teltonika_Data_Sending_Parameters_ID`,
}

/**
 * External Voltage (66) and Battery Voltage (67) where the page still writes `mV`.
 *
 * Teltonika corrected this themselves: `Template:FMX650_AVL_ID` publishes the identical id-67 row as
 * `0,001 | V`, and its hardware column (`Template:AVL_ID_HW_list_FMX6XX`) expands to exactly
 * FMB640/FMC640/FMM640/FMC650/FMM650.
 *
 * Four of the five pages still reading mV share `Template:FMX640_AVL_ID` — which publishes id 66 as
 * V and id 67 as mV, in the same table. `fm6300` is NOT one of them: it transcludes no template at
 * all and carries 360 KB inline. So this is not one stale file; it is the same row written two ways
 * in two places, which is why the in-repo contradiction is the evidence that needs no wiki.
 *
 * The back-up battery is Ni-MH 8.4–10.0 V (`Template:FMB640_Battery_information`) and the vendor's
 * own runtime table measures "Starting Voltage 10,1V" (`FMB640_General_description`); under the
 * literal reading the full scale of both elements would be 30 mV, three hundred times below the
 * battery's own minimum.
 */
const SUPPLY_VOLTAGE: Correction = {
  rule: 'SUPPLY_VOLTAGE',
  landing: { kind: 'converts-to', unit: 'V' },
  reason:
    'the Units cell names the RAW millivolt count; × 0.001 lands in volts. Teltonika publishes the ' +
    'identical row as "0,001 | V" on Template:FMX650_AVL_ID for the same hardware, and our own ' +
    'fmc650 table already carries V for this element — the same raw value renders 12.6 V there and ' +
    '0.0 V here. The back-up battery is Ni-MH 8.4-10.0 V (Template:FMB640_Battery_information) and ' +
    'starts at 10,1 V (FMB640_General_description); a literal mV reading caps both at 30 mV.',
  source: `${WIKI}/Template:FMX650_AVL_ID`,
}

/**
 * The EV / high-voltage rows, which look ambiguous and are NOT.
 *
 * A multiplier GREATER than one cannot convert away from a milli- prefix: there is no smaller unit
 * for it to land in. And the sibling CURRENT rows settle it arithmetically — 10880 and 10886 are
 * published as `−1600000..1612750 mA`, which is exactly raw `−32000..32255 × 50`, so on those rows
 * the Units cell demonstrably describes the result.
 *
 * Do NOT read the voltage rows' Min/Max as the same evidence: 10879 and 10887 publish
 * `0..4294967295`, the raw 32-bit field range. Six adjacent rows on one template follow two
 * conventions, so Min/Max is not a discriminator here — the multiplier's direction and the current
 * rows are. A 400 V traction pack reports 8000.
 *
 * `× 1` cannot be a conversion either — a cell voltage of 3700 is 3700 mV. Those rows (10901/10902)
 * are declared but INERT: nothing is written for them, because a no-op multiplier leaves the cell
 * describing raw and result alike and the guard never asks. They are written down so a reader who
 * checks the ×50 rows finds them decided too.
 */
const EV_PACK: Correction = {
  rule: 'EV_PACK',
  landing: { kind: 'stated' },
  reason:
    'the Units cell describes the RESULT: a multiplier above 1 cannot convert away from a milli- ' +
    'prefix, and the sibling current rows 10880/10886 publish -1600000..1612750 mA = raw ' +
    '-32000..32255 x 50, post-multiplier. A 400 V pack reports 8000. The display SI rescale is ' +
    'correct here and must be kept. (10879/10887 publish the raw 32-bit range, so Min/Max is not ' +
    'the discriminator on this template.)',
  source: `${WIKI}/FMC650_Teltonika_Data_Sending_Parameters_ID`,
}

/**
 * The UL202 ultrasonic fuel-level sensor: a liquid HEIGHT, reported in tenths of a millimetre.
 *
 * OUR OWN TABLES SETTLE IT, and this is the decisive evidence rather than the prose. The FMB1XX
 * pages document id 327 with `min −150`; the FMX6XX pages document the same sensor as ids 224/225
 * with `min −15 | mm`. That is one physical minimum written twice — once before the multiplier and
 * once after — so `raw × 0.1` IS the millimetre figure and the Units cell describes the result.
 *
 * The sensor's own front panel agrees, in Teltonika's install procedure: it reads `000.0` before the
 * probe is coupled and "the predicted level is about 300mm and displayed 285.2mm" once it is — four
 * digits, one decimal, millimetres. Read as centimetres instead, the full 16-bit scale would be a
 * 32.7-metre tank.
 *
 * Honest limit on the panel argument alone: the page never states the RS232 or AVL wire encoding, so
 * "285.2 on the panel is 2852 on the wire" would be an assumption on its own. The two tables are what
 * make it arithmetic. (The earlier draft of this note said a centimetre reading would overshoot by
 * 100× — mm to cm is a factor of 10.)
 *
 * This one carried no display bug — the web layer rescales mV and mA and has no rule for mm — so it
 * is a units-label correction only. It is declared because the guard cannot tell the harmless case
 * from the 0.0 V case, and being made to decide is the entire point of the guard.
 */
const ULTRASONIC_FUEL_LEVEL: Correction = {
  rule: 'ULTRASONIC_FUEL_LEVEL',
  landing: { kind: 'stated' },
  reason:
    'the Units cell describes the RESULT: the FMB1XX pages document this sensor with min -150 and ' +
    'the FMX6XX pages document it with min -15 mm — the same physical minimum, once before the ' +
    'multiplier and once after, so raw x 0.1 IS the millimetre figure. The sensor panel agrees ' +
    '("displayed 285.2mm", 000.0 uncoupled); read as centimetres the full scale would be a ' +
    '32.7-metre tank.',
  source: `${WIKI}/UL202_Ultrasonic_Fuel_Sensor`,
}

/** `<table>:<id>` → correction. Built from groups so forty decisions do not become forty copies. */
export const CORRECTIONS: Record<string, Correction> = {}

const declare = (tables: string[], ids: number[], c: Correction) => {
  for (const t of tables) for (const id of ids) CORRECTIONS[`${t}:${id}`] = c
}

// ── Class A: the Units cell names the PRE-multiplier unit. These are the reported defect. ──
declare(['fmb010', 'fmb150', 'fmc150', 'fmc250', 'fmm150', 'fmm80a'], [6, 9], ANALOG_INPUT)
declare(['fm6300'], [66, 67], SUPPLY_VOLTAGE)
declare(['fmb640', 'fmb641', 'fmc640', 'fmm650'], [67], SUPPLY_VOLTAGE)
// ids 66 on fmb640/fmb641/fmc640/fmm650 already read `V` and need no correction.

// ── Class B: the Units cell already describes the result. Declared, not defaulted. ──
declare(['fmb641', 'fmc640', 'fmc650', 'fmm650'], [10879, 10880, 10886, 10887, 10901, 10902], EV_PACK)
declare(['fm6300', 'fmb640', 'fmb641', 'fmc640', 'fmc650', 'fmm650'], [224, 225], ULTRASONIC_FUEL_LEVEL)
declare(
  ['fmb001', 'fmb010', 'fmb120', 'fmb150', 'fmb930', 'fmc150', 'fmc250', 'fmc880', 'fmm150', 'fmm80a', 'fmm880'],
  [327],
  ULTRASONIC_FUEL_LEVEL,
)

/**
 * The units whose SI prefix invites a SECOND rescale after the multiplier has already been applied.
 *
 * An element that carries a scaling multiplier AND one of these units is exactly the ambiguous shape
 * above, and the generator refuses to guess which way it goes: it must appear in CORRECTIONS. The
 * display rescales only mV and mA today; mm, ml, mG and mg are held to the same standard because the
 * reading error is in the LABEL either way — `raw × 0.1 mm` is a different quantity from
 * `(raw mm) × 0.1`, whether or not a display currently divides it again.
 */
export const AMBIGUOUS_UNITS = new Set(['mV', 'mA', 'mm', 'ml', 'mG', 'mg'])

/**
 * Does this multiplier actually SCALE?
 *
 * `× 1` is a no-op, so the Units cell describes raw and result alike and there is nothing to decide —
 * 18 rows in the corpus (8 mm, 8 mV, 2 ml) sit at exactly 1, and demanding a citation for them would
 * be noise that trains a reader to wave the guard through. Anything that is NOT provably 1 counts as
 * scaling, including the 129 cells that are not numbers at all (`0.01*`, `acc and braking: 0.01`):
 * a multiplier we cannot read is the last thing that should be assumed harmless. Both decimal
 * conventions occur, sometimes in one file, so the comma is handled here as in parseMultiplier.
 */
export const isScalingMultiplier = (multiplier: string | undefined): boolean => {
  if (multiplier === undefined) return false
  const n = Number(multiplier.replace(',', '.'))
  return !(Number.isFinite(n) && n === 1)
}

/**
 * Can a READER apply this multiplier at all?
 *
 * Mirrors `parseMultiplier` in packages/codec (which this package cannot import — it has no
 * dependencies by design): comma or point, digits only, greater than zero. Everything else is
 * refused there rather than salvaged, so the value reaches the browser UNMULTIPLIED.
 *
 * That is why this predicate exists here too. A declaration that CHANGES the unit is a claim about
 * arithmetic the reader must then perform; if the reader cannot read the multiplier, it labels the
 * raw wire value with the post-multiplier unit and 12600 renders as "12600 V" — worse than the
 * `0.0 V` this file exists to fix. The generator refuses that pairing outright. If the two rules
 * ever drift apart, the failure is silent, so they are asserted against the same cases in
 * __tests__/corrections.spec.ts.
 */
export const isReadableMultiplier = (multiplier: string | undefined): boolean => {
  if (multiplier === undefined) return false
  const t = multiplier.trim().replace(',', '.')
  return /^\d+(\.\d+)?$/.test(t) && Number(t) > 0
}

/** Is this the shape a human must decide before the dictionary may be written? */
export const needsDeclaration = (units: string | undefined, multiplier: string | undefined): boolean =>
  units !== undefined && AMBIGUOUS_UNITS.has(units) && isScalingMultiplier(multiplier)

export const correctionFor = (table: string, id: string): Correction | undefined => CORRECTIONS[`${table}:${id}`]

/**
 * EXACTLY what the generator writes into a row's `unitAfterMultiplier` — the one definition of the
 * emit rule, called by main.ts and compared against the shipped files by the test.
 *
 * Written once because the two were separately checkable and never checked against each other: 59 of
 * the 65 declarations here could be deleted with every gate green, since `corrections.spec.ts` reads
 * only this file and the codec sweeps read only the JSON. "Change a declaration, forget to run the
 * generator" is the single most likely edit in this file's life, and it was invisible.
 *
 * `undefined` means WRITE NOTHING; `null` is written, and means the opposite of absent.
 */
export function emittedUnitAfterMultiplier(
  table: string,
  id: string,
  units: string | undefined,
  multiplier: string | undefined,
): string | null | undefined {
  const declared = unitAfterMultiplierFor(table, id, units)
  if (declared === null) return null
  // emitted where the answer is not derivable from `units` alone: every ambiguous row (so the file
  // proves a human decided it, confirmations included) and any row whose landing differs from its cell
  if (declared !== undefined && (needsDeclaration(units, multiplier) || declared !== units)) return declared
  return undefined
}

/**
 * The unit of `raw × multiplier`: a string when it is known, `null` when we refuse to claim one, and
 * `undefined` when no human has decided this row at all. A `stated` landing resolves against the
 * element's own cell rather than duplicating that cell into forty literals.
 */
export function unitAfterMultiplierFor(table: string, id: string, units: string | undefined): string | null | undefined {
  const c = correctionFor(table, id)
  if (c === undefined) return undefined
  switch (c.landing.kind) {
    case 'converts-to':
      return c.landing.unit
    case 'stated':
      return units ?? null
    case 'refuse':
      return null
  }
}
