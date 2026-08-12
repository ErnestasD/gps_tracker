/**
 * Parser for the Teltonika wiki's "Data Sending Parameters ID" tables (CLAUDE.md rule 8: every AVL
 * claim in this repo traces to a wiki URL, and this is the only thing allowed to assert one).
 *
 * Kept PURE and separate from fetching so it can be tested against a committed HTML sample instead
 * of the live wiki. The generated dictionaries are the product; this is how they stay reproducible
 * rather than hand-maintained — the previous files were generated once and drifted 51% behind.
 */

export interface AvlEntry {
  name: string
  bytes: string
  type: string
  /** The wiki's own Min/Max, kept verbatim. They are the evidence the Type column is wrong when it
   *  is (a documented minimum of −600 cannot be unsigned), and they let a decoder assert that a
   *  value is plausible: read as unsigned, −1.0 °C arrives as 6552.6 °C — absurd, not subtly off. */
  min?: string
  max?: string
  multiplier?: string
  units?: string
  description?: string
  /** The wiki's own "HW Support" column — which models can actually produce this element. */
  hwSupport?: string
  /** The wiki's own "Parameter Group" column, e.g. "Permanent I/O Elements". */
  group?: string
}

export interface ParseResult {
  elements: Record<string, AvlEntry>
  /** Every deviation from a clean parse. A dictionary is only trustworthy if these are read. */
  warnings: string[]
}

const strip = (s: string): string =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The wiki's Type column, as actually spelled across all 105 model pages. Both directions of typo
 * occur — `Unsinged` (156 rows) for Unsigned and `Singed` (16 rows) for Signed — and only the second
 * is dangerous, because `applySign` compares Type EXACTLY and therefore leaves those rows
 * unsigned. Every normalisation is RECORDED as a warning so a reviewer sees what we changed and can
 * check it against the page.
 */
const TYPE_ALIASES: Record<string, string> = {
  'unsigned': 'Unsigned',
  'unsiged': 'Unsigned',
  'unsinged': 'Unsigned',
  'unisgned': 'Unsigned',
  'unsigned long int': 'Unsigned',
  'signed': 'Signed',
  'singed': 'Signed',
}
/** Types that carry no numeric sign at all; no sign handling applies and no warning is warranted. */
const NON_NUMERIC = new Set(['HEX', 'ASCII', '<STRING>'])

/** A cell the wiki uses to mean "nothing here". */
const blank = (s: string): boolean => s === '' || s === '-' || s === '–' || s === 'N/A'

/**
 * Column order is read from the HEADER, never assumed. The table carries a merged "Value range"
 * header spanning Min/Max, so a positional parser silently shifts Multiplier into Units the day a
 * column is added — which is exactly the class of error a dictionary must not have.
 */
function headerIndex(headerCells: string[]): Record<string, number> | null {
  const idx: Record<string, number> = {}
  let col = 0
  for (const raw of headerCells) {
    const h = raw.toLowerCase()
    if (h.includes('property id')) idx['id'] = col
    else if (h.includes('property name')) idx['name'] = col
    else if (h === 'bytes') idx['bytes'] = col
    else if (h === 'type') idx['type'] = col
    else if (h.includes('value range')) { idx['min'] = col; col += 1 } // spans Min + Max
    else if (h === 'multiplier') idx['multiplier'] = col
    else if (h === 'units') idx['units'] = col
    else if (h === 'description') idx['description'] = col
    else if (h.includes('hw support')) idx['hwSupport'] = col
    else if (h.includes('parameter group')) idx['group'] = col
    col += 1
  }
  return idx['id'] !== undefined && idx['name'] !== undefined ? idx : null
}

export function parseAvlTable(html: string): ParseResult {
  const warnings: string[] = []
  const elements: Record<string, AvlEntry> = {}
  const seen = new Map<string, string>() // id → the name we kept, for duplicate reporting

  for (const table of html.match(/<table[\s\S]*?<\/table>/g) ?? []) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? []
    if (rows.length < 2) continue
    const headCells = (rows[0]!.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? []).map(strip)
    const idx = headerIndex(headCells)
    if (idx === null) continue

    for (const row of rows.slice(1)) {
      const cells = (row.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? []).map(strip)
      const id = cells[idx['id']!] ?? ''
      if (!/^\d+$/.test(id)) continue // the Min/Max sub-header row and any prose row
      // An AVL element id is 2 bytes on the wire (Codec 8E and 16 both), so anything above 65535
      // cannot arrive from a device and must not enter a dictionary. Today this catches exactly one
      // row: FMC650 lists "Auxil ext valve number 9" as 124451, sitting in a sequence that runs
      // 12442, 12443 … 12450, [gap], 12452 — i.e. an extra digit in 12451. It is NOT corrected
      // here: writing a protocol id from inference is precisely what rule 8 forbids without a
      // citation, and the cost of leaving it out is that one element surfaces as io_12451 rather
      // than named. Reported so a human can raise it with Teltonika.
      if (Number(id) > 0xffff) {
        warnings.push(`id ${id}: above the 2-byte AVL ceiling (65535) — cannot occur on the wire, dropped`)
        continue
      }
      const name = cells[idx['name']!] ?? ''
      if (name === '') {
        warnings.push(`id ${id}: row has no Property Name — skipped`)
        continue
      }
      if (seen.has(id)) {
        // The wiki really does define some ids twice with different meanings (TAT100 463/467/471/475,
        // FMB640 138/192). FIRST wins, deterministically, and the conflict is reported rather than
        // resolved silently — picking the wrong one mislabels a customer's data.
        if (seen.get(id) !== name) warnings.push(`id ${id}: defined twice — kept "${seen.get(id)!}", ignored "${name}"`)
        continue
      }
      seen.set(id, name)
      const pick = (k: string): string | undefined => {
        const i = idx[k]
        if (i === undefined) return undefined
        const v = cells[i] ?? ''
        return blank(v) ? undefined : v
      }
      const entry: AvlEntry = { name, bytes: pick('bytes') ?? '', type: pick('type') ?? '' }
      if (idx['min'] !== undefined) {
        const mn = cells[idx['min']] ?? ''
        const mx = cells[idx['min']! + 1] ?? ''
        if (!blank(mn)) entry.min = mn
        if (!blank(mx)) entry.max = mx
      }
      for (const k of ['multiplier', 'units', 'description', 'hwSupport', 'group'] as const) {
        const v = pick(k)
        if (v !== undefined) entry[k] = v
      }
      const raw = entry.type
      const norm = TYPE_ALIASES[raw.toLowerCase().replace(/\s+/g, ' ').trim()]
      if (norm !== undefined && norm !== raw) {
        entry.type = norm
        warnings.push(`id ${id}: Type "${raw}" normalised to ${norm}`)
      } else if (norm === undefined && !NON_NUMERIC.has(raw.toUpperCase()) && raw !== '') {
        warnings.push(`id ${id}: unrecognised Type "${raw}" — left verbatim, sign handling will not apply`)
      }
      // CROSS-CHECK against the wiki's own Min column, which is evidence the Type column is not.
      // This is how the "Singed" typo was caught: Engine Oil Temperature (1270) reads Min −60 °C and
      // Engine Fuel Temperature (1343) Min −40 °C, so those rows are unambiguously signed however
      // they are spelled. `applySign` compares Type EXACTLY, so an unnormalised typo silently turns
      // a winter oil temperature into a large positive — the same class of defect as a wrong flag,
      // arriving through spelling. Anything this catches in future is a new typo, not a new rule.
      const min = idx['min'] !== undefined ? (cells[idx['min']] ?? '') : ''
      if (/^-\d/.test(min) && entry.type !== 'Signed') {
        warnings.push(`id ${id}: Min is ${min} but Type is "${entry.type}" — negative values will read as large positives`)
      }
      elements[id] = entry
    }
  }
  return { elements, warnings }
}

/**
 * Reconcile the Type column ACROSS pages.
 *
 * Teltonika documents the same parameter on several model pages, and twice those pages contradict
 * each other on Signed/Unsigned while agreeing on everything else — name, bytes, multiplier, units,
 * and the value range down to the digit. An identical definition with a contradictory flag is a
 * transcription error, not a different encoding, so the Signed reading wins: a parameter whose own
 * documented minimum is negative cannot be unsigned, and `applySign` compares Type exactly.
 *
 * Verified, and for 141 confirmed by Teltonika's own edit history rather than by inference:
 *
 *   141 Battery Temperature — Min −600 (−60.0 °C). `Template:FMX650 AVL ID` revision 114084
 *     (2026-06-05, user Arijus.C, comment "CAN adapters elements") changes exactly one cell in a
 *     1.5 MB template: Unsigned → Signed on this row, with bytes/min/max/multiplier untouched. The
 *     pages still reading Unsigned all transclude ONE stale template (`Template:FMX640 AVL ID`,
 *     last edited 2026-02-25), so this is 2 independent tables against 1, not 4 against 2 — count
 *     sources, not pages. No page has ever been edited Signed → Unsigned.
 *   210 LLS 3 Fuel Level    — Min −4, Max 32767, which is the signed 16-bit ceiling exactly; an
 *     unsigned 2-byte field would document 65535.
 *
 * This rule is therefore what keeps the correction alive: regenerating without it would silently
 * return four dictionaries to Unsigned, and a −1.0 °C battery would surface as 6552.6 °C.
 *
 * It must NOT fire on the ~34 CAN parameters whose Min is negative while Unsigned is correct:
 * coolant temperature (−40 °C), aftertreatment temperatures (−273 °C), percent torque (−125 %).
 * Those are SAE J1939 OFFSET encodings — unsigned on the wire, offset applied on display — and no
 * page marks any of them Signed, so consensus never sees a conflict. A rule keyed on "Min < 0"
 * alone would have broken all 34 in order to fix these 2.
 */
export function applyTypeConsensus(tables: Record<string, AvlEntry>[]): string[] {
  const sig = (id: string, e: AvlEntry): string => `${id}|${e.name}|${e.bytes}|${e.multiplier ?? ''}|${e.units ?? ''}`
  const signed = new Set<string>()
  for (const t of tables) for (const [id, e] of Object.entries(t)) if (e.type === 'Signed') signed.add(sig(id, e))
  const corrections: string[] = []
  for (const t of tables) {
    for (const [id, e] of Object.entries(t)) {
      if (e.type === 'Unsigned' && signed.has(sig(id, e))) {
        e.type = 'Signed'
        corrections.push(`id ${id}: Type says Unsigned here but Signed on another Teltonika page for an otherwise identical definition — corrected to Signed`)
      }
    }
  }
  return corrections
}
