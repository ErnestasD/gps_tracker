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
  /**
   * The wiki's Multiplier cell, VERBATIM AND DISPLAY-ONLY — never `Number()` this without handling
   * what is actually in it. Across the corpus it is written in two decimal conventions, sometimes
   * within one file (`0.1` ×468 and `0,1` ×215, `0.001` and `0,001`), and 129 rows are not a number
   * at all: `0.01*` ×56, `0.1*` ×56, `acc and braking: 0.01` ×17. `Number()` therefore returns NaN
   * for 393 of the 1335 multiplier cells — 29% — which silently drops the scaling on a
   * customer-visible number rather than failing. Nothing reads
   * it today — `health.ts` and `fuel.ts` carry their own constants for the handful of elements they
   * scale — so this is a hazard note, not a live defect. The day something does need it, the
   * conversion belongs in ONE place with the non-numeric forms rejected loudly.
   */
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
    // numeric entities too: atc700 id 11399 carried a literal "&#160;" into its Type AND its Bytes
    // cell. Harmless for applySign, but the same path reaches `name`, and a dictionary is the one
    // place in this repo allowed to say what a parameter IS.
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
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

/**
 * Top-level `<tag>…</tag>` blocks only — a nested one is part of its parent's CONTENT, not a sibling.
 *
 * Every level of the table has to be walked this way, because a non-greedy `[\s\S]*?` match ends the
 * outer element at the FIRST nested closing tag, and the wiki really does put a small state-code
 * `<table>` inside a Description cell:
 *
 *   - at TABLE level, `/<table[\s\S]*?<\/table>/g` ended the FM36 table at row 12, so the dictionary
 *     shipped 12 of 137 elements — losing Ignition, Movement, the Dallas temperatures, iButton and
 *     the odometer — with an empty `warnings` array;
 *   - at CELL level the same shape ended the Description cell at the nested table's first `</td>`,
 *     which truncated the description AND shifted the two trailing columns off the row. Fixing only
 *     the table level would have produced 137 FM36 elements — a right-looking count — with 19 of
 *     them (again including 239 Ignition and 240 Movement Sensor) carrying the NESTED table's text
 *     in `hwSupport` and `group`: `hwSupport: "1 – ignition on"`. That state was measured on the
 *     intermediate fix and never committed; what shipped before was the 12-element truncation.
 *
 * Truncation that reports success is the worst shape a generator can have, so there is exactly one
 * extractor and all three levels use it. Depth counting works for rows and cells as well as tables
 * because a nested table's `<tr>`/`<td>` are inside the outer `<tr>`/`<td>` and so never reach 0.
 */
function topLevelBlocks(html: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<(/?)(?:${tag})\\b[^>]*?(/?)>`, 'gi')
  let depth = 0
  let start = 0
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    // `<td/>` opens and closes in one tag. Without this the empty cell swallows the rest of the row
    // — every later column shifts one place left and the row parses to blanks with no warning. No
    // page uses the form today; the cost of allowing for it is one capture group.
    if (m[1] === '' && m[2] === '/') {
      if (depth === 0) out.push(m[0])
      continue
    }
    if (m[1] === '') {
      if (depth === 0) start = m.index
      depth += 1
    } else if (depth > 0) {
      depth -= 1
      if (depth === 0) out.push(html.slice(start, m.index + m[0].length))
    }
  }
  return out
}

const topLevelTables = (html: string): string[] => topLevelBlocks(html, 'table')
const topLevelRows = (table: string): string[] => topLevelBlocks(table, 'tr')
const topLevelCells = (row: string): string[] => topLevelBlocks(row, 'td|th')

/** Header cells with their declared colspan, so the Min/Max span comes from the markup. */
function headerCells(row: string): { text: string; span: number }[] {
  return topLevelCells(row).map((cell) => {
    const span = /colspan\s*=\s*["']?(\d+)/i.exec(cell)
    return { text: strip(cell), span: span ? Math.max(1, Number(span[1])) : 1 }
  })
}

/** A cell the wiki uses to mean "nothing here". */
const blank = (s: string): boolean => s === '' || s === '-' || s === '–' || s === 'N/A'

/**
 * Column order is read from the HEADER, never assumed. The table carries a merged "Value range"
 * header spanning Min/Max, so a positional parser silently shifts Multiplier into Units the day a
 * column is added — which is exactly the class of error a dictionary must not have.
 */
function headerIndex(cells: { text: string; span: number }[]): Record<string, number> | null {
  const idx: Record<string, number> = {}
  let col = 0
  for (const { text, span } of cells) {
    // WHITESPACE-STRIPPED. The wiki writes one header as `T<p>ype</p>`, which strips to "T ype" and
    // fails an exact comparison — silently, because a missing Type index yields `type: ''` on every
    // row and the "unrecognised Type" warning only fires for a NON-empty value. That discarded the
    // Type column on five CAN-line pages, 41 elements each, and then the consensus rule "corrected"
    // the blanks it had itself created. A header this load-bearing must not depend on markup.
    const h = text.toLowerCase().replace(/\s+/g, '')
    if (h.includes('propertyid')) idx['id'] = col
    else if (h.includes('propertyname')) idx['name'] = col
    else if (h === 'bytes') idx['bytes'] = col
    else if (h === 'type') idx['type'] = col
    // three spellings exist across the 105 pages: a `Value range` cell spanning Min+Max, and
    // separate `Min Value`/`Max Value` or `Min`/`Max` columns. Only the first was handled, so 1830
    // elements across 12 dictionaries shipped with no range at all — and the range is what the
    // Type cross-check and the consensus signature are built on.
    //
    // Where Max sits differs BETWEEN those spellings, so it is recorded per spelling rather than
    // assumed to be min+1 everywhere. Under a merged `Value range` the sub-header row literally
    // reads `Min | Max`, so Max is the span's second column; under separate headers there is a real
    // `Max` cell and we index it. Sharing one rule between them would have silently read the Min
    // column twice the day a page switched spelling.
    else if (h.includes('valuerange')) {
      idx['min'] = col
      if (span >= 2) idx['max'] = col + 1
    } else if (h === 'min' || h === 'minvalue') idx['min'] = col
    else if (h === 'max' || h === 'maxvalue') idx['max'] = col
    else if (h === 'multiplier') idx['multiplier'] = col
    else if (h === 'units') idx['units'] = col
    else if (h === 'description') idx['description'] = col
    else if (h.includes('hwsupport')) idx['hwSupport'] = col
    else if (h.includes('parametergroup')) idx['group'] = col
    // …and the span comes from the MARKUP, not from the header word. `Value range` declares
    // colspan=2; hardcoding that is one wiki edit away from shifting Multiplier into Units, which
    // is a silent factor-of-ten error in a customer-visible number.
    col += span
  }
  return idx['id'] !== undefined && idx['name'] !== undefined ? idx : null
}

/** Build one entry from a row. Extracted so the duplicate check compares a whole entry, not a name. */
function candidate(cells: string[], idx: Record<string, number>, name: string): AvlEntry {
  const pick = (k: string): string | undefined => {
    const i = idx[k]
    if (i === undefined) return undefined
    const v = cells[i] ?? ''
    return blank(v) ? undefined : v
  }
  const entry: AvlEntry = { name, bytes: pick('bytes') ?? '', type: pick('type') ?? '' }
  if (idx['min'] !== undefined) {
    const mn = cells[idx['min']] ?? ''
    // `?? idx.min + 1` only for a merged header that declared no usable span; the normal paths both
    // set an explicit max index.
    const mx = cells[idx['max'] ?? idx['min'] + 1] ?? ''
    if (!blank(mn)) entry.min = mn
    if (!blank(mx)) entry.max = mx
  }
  for (const k of ['multiplier', 'units', 'description', 'hwSupport', 'group'] as const) {
    const v = pick(k)
    if (v !== undefined) entry[k] = v
  }
  return entry
}

export function parseAvlTable(rawHtml: string): ParseResult {
  const warnings: string[] = []
  const elements: Record<string, AvlEntry> = {}
  const seen = new Map<string, string>() // id → the name we kept, for duplicate reporting
  // Comments FIRST: the depth counter reads tag text, and a commented-out `</table>` inside a cell
  // closes the table for it. The wiki's skin injects ~639 comments per page and none contains table
  // markup today, so this is prophylactic — but the failure mode is the whole page parsing to
  // nothing, which `main.ts` reports as "no AVL table found" and a reader would blame on the fetch.
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, ' ')

  for (const table of topLevelTables(html)) {
    const rows = topLevelRows(table)
    if (rows.length < 2) continue
    const header = headerCells(rows[0]!)
    const idx = headerIndex(header)
    if (idx === null) continue
    const headerWidth = header.reduce((n, h) => n + h.span, 0)

    for (const row of rows.slice(1)) {
      const rawCells = topLevelCells(row)
      const cells = rawCells.map(strip)
      const id = cells[idx['id']!] ?? ''
      if (!/^\d+$/.test(id)) continue // the Min/Max sub-header row and any prose row
      // Data cells are read by COLUMN INDEX, which is only sound while every data row is a flat list
      // of single cells. The header legitimately spans (rowspan=2 over the Min/Max sub-header,
      // colspan=2 on "Value range") and that is handled; a span in a DATA row is different — it
      // slides every later column of this row, or of the next, one place left, and the result is a
      // multiplier read as units with nothing to notice it. Across all 105 pages today this fires
      // ZERO times, which is the point: it is here so that a wiki edit introducing one is reported
      // rather than absorbed. (Rows SHORT of the header are separate and harmless — 53 pages end
      // "264 Barcode ID" one cell early, which drops Parameter Group and shifts nothing.)
      const spans = rawCells.some((c) => [...c.matchAll(/(?:row|col)span\s*=\s*["']?(\d+)/gi)].some((m) => Number(m[1]) > 1))
      if (spans) warnings.push(`id ${id}: a data cell spans rows or columns — column alignment is not guaranteed for this row`)
      // …and the row must not be WIDER than the header, which is the case the colspan handling above
      // does NOT cover and review proved: `col += span` under-advances if the wiki ever drops the
      // `colspan="2"` from `Value range`, and then every later column slides — Multiplier read as
      // Units, a silent factor-of-ten in a customer-visible number, with a clean `warnings: []`
      // because the range cross-check is reading the shifted cells too. A row SHORT of the header is
      // different and deliberately unflagged: 53 pages end "264 Barcode ID" one cell early, which
      // drops Parameter Group and shifts nothing. Over-wide rows today: zero.
      if (rawCells.length > headerWidth) {
        warnings.push(`id ${id}: row has ${rawCells.length} cells but the header declares ${headerWidth} columns — column alignment is not guaranteed`)
      }
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
        // …and compare the WHOLE entry, not just the name. 62 distinct ids are repeated on their own
        // page with the same name but different columns (109 warnings across the 34 tables) —
        // FMB640's id 239 "Ignition" appears with max "1" in Permanent I/O and "0xFF" in FMS Eco
        // Driving, FMC650's 10889 with multiplier "0.03125" and "0,03125".
        //
        // ELEVEN of them differ in BYTES, which IS the class that changes decoding: TFT100 lists
        // 815 "Throttle Position", 828 "Remaining Capacity", 833 "Total Distance" and eight more at
        // both 1/2/4 bytes and 8. First wins, so tft100.json ships the narrow width. Nothing decodes
        // wrongly today — all eleven are Unsigned, so applySign returns early — but `bytes` is what
        // the width guard in applySign reads, and this comment previously claimed no such case
        // existed. It does; it is warned, and it is a question for Teltonika, not for us to resolve.
        const first = elements[id]
        if (first !== undefined && JSON.stringify(first) !== JSON.stringify(candidate(cells, idx, name))) {
          warnings.push(`id ${id}: repeated with the same name but different columns — kept the first`)
        }
        // The wiki really does define some ids twice with different meanings (TAT100 463/467/471/475,
        // FMB640 138/192). FIRST wins, deterministically, and the conflict is reported rather than
        // resolved silently — picking the wrong one mislabels a customer's data.
        if (seen.get(id) !== name) warnings.push(`id ${id}: defined twice — kept "${seen.get(id)!}", ignored "${name}"`)
        continue
      }
      seen.set(id, name)
      const entry = candidate(cells, idx, name)
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
 *     sources, not pages. Scope of that check, stated exactly because the conclusion rests on it:
 *     the last 20 revisions of those two templates contain no Signed → Unsigned edit. "No page has
 *     ever been edited that way" is NOT verified — 105 pages × full history is beyond what the
 *     wiki's rate limiter allows, and the claim is not needed: rev 114084 is a direct correction.
 *   210 LLS 3 Fuel Level    — Min −4, Max 32767, which is the signed 16-bit ceiling exactly; an
 *     unsigned 2-byte field would document 65535.
 *
 * This rule is therefore what keeps the correction alive: regenerating without it would silently
 * return four dictionaries to Unsigned, and a −1.0 °C battery would surface as 6552.6 °C.
 *
 * It must NOT fire on the parameters whose Min is negative while Unsigned is CORRECT. Counted from
 * the generated files rather than estimated — and the first three numbers written here (32, and 34
 * twice in the spec) were all wrong, which is why it is now derived: 28 distinct (id, name)
 * pairs carry a negative Min without being Signed, and most are
 * SAE J1939 OFFSET encodings — coolant temperature (−40 °C), aftertreatment temperatures (−273 °C),
 * percent torque (−125 %) — unsigned on the wire with the offset applied on display. No page marks
 * any of those Signed, so consensus never sees a conflict there. A rule keyed on "Min < 0" alone
 * would have rewritten all 28 in order to fix 2.
 *
 * Two of the 28 are NOT offset encodings and are probably wiki Type errors we cannot prove:
 * id 1333 "Steering wheel turn counter" (Min −32, Max 29, ONE byte — a symmetric range in a byte is
 * a signed field) and id 618 "ADAS Ahead speed" (Min −128, Max 126, km/h). They stay untouched: no
 * second page contradicts them, so there is nothing to reconcile against, and correcting them would
 * be inference. Both are flagged by the Min cross-check for a human to raise with Teltonika.
 */
export function applyTypeConsensus(tables: Record<string, AvlEntry>[]): { table: number; note: string }[] {
  // min/max are part of the identity, not decoration. Without them 156 signatures across the 34
  // tables resolve to entries with different ranges or descriptions — "Neighbouring Cell 1 MNC" is
  // documented for Cell #1 on some pages and Cell #4 on others under the same key. None of those
  // currently carries a Type disagreement, so the rule does not mis-fire today; it was luck, and
  // the range is exactly what the comment above claims to rely on.
  //
  // `description` and `hwSupport` are deliberately NOT in the signature, and that is load-bearing
  // rather than an oversight: id 210's donor (FMB640) documents the sensor as wired "via RS232" and
  // lists the 640 family, while the recipients say "via RS485" and list the 125 family. Same
  // parameter, different wiring text — including description would drop the correction and return
  // eleven dictionaries to Unsigned on a field whose own documented Min is −4. The note below
  // therefore states exactly what WAS compared instead of claiming "otherwise identical".
  const sig = (id: string, e: AvlEntry): string =>
    `${id}|${e.name}|${e.bytes}|${e.multiplier ?? ''}|${e.units ?? ''}|${e.min ?? ''}|${e.max ?? ''}`
  const signed = new Set<string>()
  for (const t of tables) for (const [id, e] of Object.entries(t)) if (e.type === 'Signed') signed.add(sig(id, e))
  // Attributed to the table whose entry was actually rewritten. Attribution by bare id put the
  // note on every table defining that id — including `fmb120`, whose id 141 is "Driver 1 Cumulative
  // Break Time", an unrelated parameter the rule must never touch, and including the SOURCE tables
  // that were already Signed. `warnings` is the audit trail for a rule-8 artefact; a reader who
  // greps it and finds a correction that did not happen cannot tell which record is lying.
  const corrections: { table: number; note: string }[] = []
  for (const [index, t] of tables.entries()) {
    for (const [id, e] of Object.entries(t)) {
      // `!== 'Signed'`, not `=== 'Unsigned'`, so a blank cell is reconcilable too — but read the
      // history before trusting that branch. It was added because BLE Temperature #1–#4 came through
      // BLANK on the CAN-line pages while fmb120 said Signed, and the stated reason ("those pages
      // leave the Type cell empty") was FALSE: this parser was dropping the column, because that
      // header is written `T<p>ype</p>` and the match was exact. Fixing the header took the corpus
      // from 190 blank types to 26, and the blank branch now fires on none of them — the only
      // corrections left are ids 141 and 210, each justified by its own value range. The branch
      // stays as defence against a genuinely empty cell, not because we have seen one.
      // Non-numeric types are excluded — HEX and ASCII carry no sign to correct.
      if (e.type !== 'Signed' && !NON_NUMERIC.has(e.type.toUpperCase()) && signed.has(sig(id, e))) {
        const was = e.type === '' ? 'blank' : e.type
        e.type = 'Signed'
        const range = e.min !== undefined || e.max !== undefined ? ` (range ${e.min ?? '?'}..${e.max ?? '?'})` : ''
        corrections.push({
          table: index,
          note: `id ${id}: Type was ${was} here but Signed on another Teltonika page for the same name, width, multiplier, units and value range${range} — corrected to Signed. Description and HW Support were NOT compared and do differ`,
        })
      }
    }
  }
  return corrections
}
