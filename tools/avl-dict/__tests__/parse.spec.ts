import { describe, expect, it } from 'vitest'

import { applyTypeConsensus, parseAvlTable, type AvlEntry } from '../src/parse.js'

/**
 * The dictionary is the only place this repo is allowed to assert what an AVL id MEANS (rule 8), so
 * a parser bug here mislabels customer data platform-wide. These samples reproduce the real shapes
 * the Teltonika wiki uses, including the ones that have already bitten: a merged "Value range"
 * header spanning two columns, ids defined twice with different meanings, and the "Unsiged" typo.
 */
const table = (rows: string): string => `
<table class="wikitable">
<tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th>
    <th colspan="2">Value range</th><th>Multiplier</th><th>Units</th><th>Description</th>
    <th>HW Support</th><th>Parameter Group</th></tr>
<tr><th>Min</th><th>Max</th></tr>
${rows}
</table>`

const row = (c: string[]): string => `<tr>${c.map((x) => `<td>${x}</td>`).join('')}</tr>`

describe('AVL table parser', () => {
  it('reads columns by HEADER, so a merged Value range does not shift Multiplier into Units', () => {
    // Positional parsing looks right until a column moves. "Value range" spans Min+Max, so the
    // multiplier sits at index 6, not 4 — get that wrong and every scaled value is off by a decade.
    const r = parseAvlTable(table(row(['84', 'Fuel Level', '2', 'Unsigned', '0', '65535', '0.1', 'l', 'Value in liters', 'FMB120', 'LVCAN200'])))
    expect(r.elements['84']).toEqual({
      name: 'Fuel Level', bytes: '2', type: 'Unsigned', min: '0', max: '65535', multiplier: '0.1', units: 'l',
      description: 'Value in liters', hwSupport: 'FMB120', group: 'LVCAN200',
    })
  })

  it('keeps the FIRST of a duplicated id and REPORTS the conflict instead of resolving it', () => {
    // TAT100 really does define 463/467/471/475 twice with contradictory meanings, and FMB640 does
    // the same for 138/192. Picking silently would mislabel a customer's data with no trace.
    const r = parseAvlTable(table(
      row(['463', 'BLE 1 Custom #2', '1', 'Unsigned', '0', '1', '-', '-', 'first', 'FMB120', 'BLE']) +
      row(['463', 'BLE1 EYE sensor lost alarm', '1', 'Unsigned', '0', '1', '-', '-', 'second', 'TAT100', 'BLE']),
    ))
    expect(r.elements['463']!.name).toBe('BLE 1 Custom #2')
    expect(r.warnings.some((w) => w.includes('463') && w.includes('defined twice'))).toBe(true)
  })

  it('normalises the wiki\'s own "Unsiged" typo, and says that it did', () => {
    const r = parseAvlTable(table(row(['1234', 'Tyre Pressure', '1', 'Unsiged', '0', '255', '-', 'bar', '', 'FMB640', 'TPMS'])))
    expect(r.elements['1234']!.type).toBe('Unsigned')
    expect(r.warnings.some((w) => w.includes('Unsiged'))).toBe(true)
  })

  it('accepts the non-numeric types silently, and reports only a genuinely unknown one', () => {
    // ASCII and HEX appear 1000 times across the 105 model pages; warning about each would bury the
    // warnings that matter. They carry no sign, so there is nothing for sign handling to get wrong.
    const known = parseAvlTable(table(row(['264', 'Barcode ID', '20', 'ASCII', '-', '-', '-', '-', '', 'FMB120', 'Barcode'])))
    expect(known.warnings).toEqual([])
    expect(known.elements['264']!.type).toBe('ASCII') // left verbatim — we do not invent a sign

    const unknown = parseAvlTable(table(row(['265', 'Something', '4', 'Float64', '-', '-', '-', '-', '', 'FMB120', 'X'])))
    expect(unknown.warnings.some((w) => w.includes('265') && w.includes('Float64'))).toBe(true)
  })

  it('normalises BOTH directions of the wiki\'s Type typos, and says which it changed', () => {
    // `Singed` is the dangerous one: applySign compares Type EXACTLY, so a misspelled Signed row is
    // silently left unsigned. It is not hypothetical — Engine Oil Temperature (1270), Engine Fuel
    // Temperature (1343) and Transmission Selected Gear (1331) are all spelled that way on the live
    // CAN-line pages, and the wiki's own Min column (−60 °C, −40 °C, −128) proves they are signed.
    const r = parseAvlTable(table(
      row(['1270', 'Engine Oil Temperature', '1', 'Singed', '-60', '127', '-', '°C', '', 'FMC150', 'CAN Chip']) +
      row(['1271', 'Something Else', '1', 'Unsinged', '0', '255', '-', '-', '', 'FMC150', 'CAN Chip']),
    ))
    expect(r.elements['1270']!.type).toBe('Signed')
    expect(r.elements['1271']!.type).toBe('Unsigned')
    expect(r.warnings.filter((w) => w.includes('normalised'))).toHaveLength(2)
  })

  it('cross-checks the Type column against the wiki\'s own Min column', () => {
    // This is what caught the typos above, and it also flags 34 CAN parameters where the wiki is
    // NOT wrong: coolant temperature reads Min −40 °C and torque Min −125 % because they are SAE
    // J1939 OFFSET-encoded — unsigned on the wire, offset applied on display. So it warns and does
    // not "fix" anything: auto-setting Signed there would have broken all 34.
    const r = parseAvlTable(table(row(['1002', 'Engine Coolant Temperature', '1', 'Unsigned', '-40', '210', '-', '°C', '', 'FMB640', 'CAN'])))
    expect(r.elements['1002']!.type).toBe('Unsigned') // untouched
    expect(r.warnings.some((w) => w.includes('1002') && w.includes('Min is -40'))).toBe(true)
  })

  it('treats "-", "–" and "N/A" as absent rather than storing them as values', () => {
    const r = parseAvlTable(table(row(['239', 'Ignition', '1', 'Unsigned', '0', '1', '-', '–', 'N/A', 'FMBXXX', 'Permanent I/O Elements'])))
    expect(r.elements['239']).toEqual({ name: 'Ignition', bytes: '1', type: 'Unsigned', min: '0', max: '1', hwSupport: 'FMBXXX', group: 'Permanent I/O Elements' })
  })

  it('skips the Min/Max sub-header and any prose row without inventing an element', () => {
    const r = parseAvlTable(table(row(['Note', 'see below', '', '', '', '', '', '', '', '', ''])))
    expect(Object.keys(r.elements)).toEqual([])
  })

  it('ignores tables on the page that are not AVL tables', () => {
    const other = '<table><tr><th>Firmware</th><th>Date</th></tr><tr><td>03.27.07</td><td>2026</td></tr></table>'
    expect(Object.keys(parseAvlTable(other).elements)).toEqual([])
  })
})

describe('cross-page Type consensus', () => {
  const entry = (o: Partial<AvlEntry> & { name: string; type: string }): AvlEntry =>
    ({ bytes: '2', multiplier: '0.1', units: '°C', ...o })

  it('corrects a page that says Unsigned when another page says Signed for the SAME definition', () => {
    // 141 Battery Temperature: Min −600 on all six pages that define it, yet four say Unsigned.
    // applySign compares Type exactly, so those four decode −60 °C as roughly 6553 °C.
    const a = { '141': entry({ name: 'Battery Temperature', type: 'Signed' }) }
    const b = { '141': entry({ name: 'Battery Temperature', type: 'Unsigned' }) }
    const notes = applyTypeConsensus([a, b])
    expect(b['141'].type).toBe('Signed')
    expect(notes).toHaveLength(1)
  })

  it('leaves a J1939 offset parameter alone — no page claims it is signed', () => {
    // Coolant temperature reads Min −40 °C because it is offset-encoded, not signed. Marking it
    // Signed would corrupt ~34 CAN parameters in order to fix the two that are genuinely mislabelled.
    const a = { '1002': entry({ name: 'Engine Coolant Temperature', type: 'Unsigned', bytes: '1', multiplier: undefined }) }
    const b = { '1002': entry({ name: 'Engine Coolant Temperature', type: 'Unsigned', bytes: '1', multiplier: undefined }) }
    expect(applyTypeConsensus([a, b])).toEqual([])
    expect(a['1002'].type).toBe('Unsigned')
  })

  it('does NOT unify ids that merely share a number — the definition has to match', () => {
    // id 141 is Battery Temperature on the FMx6xx tables and "Driver 1 Cumulative Break Time"
    // (minutes) on the FMB1xx one. Same number, unrelated parameters.
    const fmx = { '141': entry({ name: 'Battery Temperature', type: 'Signed' }) }
    const fmb = { '141': entry({ name: 'Driver 1 Cumulative Break Time', type: 'Unsigned', multiplier: undefined, units: 'min.' }) }
    expect(applyTypeConsensus([fmx, fmb])).toEqual([])
    expect(fmb['141'].type).toBe('Unsigned')
  })
})

describe('the value range is kept as evidence, not decoration', () => {
  it('stores Min/Max verbatim so a decoder can tell 6552.6 °C from a real reading', () => {
    // Read as unsigned, −1.0 °C arrives as 0xFFF6 × 0.1 = 6552.6 °C. That is absurd rather than
    // subtly wrong, so the wiki's own range is enough to catch a signedness mistake at runtime —
    // in EITHER direction, including if our own consensus rule is one day wrong.
    const r = parseAvlTable(table(row(['141', 'Battery Temperature', '2', 'Signed', '-600', '1270', '0,1', '°C', '', 'FMC650', 'CAN adapters elements'])))
    expect(r.elements['141']!.min).toBe('-600')
    expect(r.elements['141']!.max).toBe('1270')
  })
})

describe('ids that cannot exist on the wire', () => {
  it('drops an id above the 2-byte AVL ceiling instead of poisoning the dictionary', () => {
    // FMC650 lists "Auxil ext valve number 9" as 124451 — an extra digit in 12451, provable from the
    // sequence it sits in (12442…12450, gap, 12452). The codec rejects any id > 0xffff when it
    // builds a dictionary, so letting this through takes the whole table down rather than losing one
    // element. Not corrected here: writing a protocol id from inference is what rule 8 forbids.
    const r = parseAvlTable(table(
      row(['12450', 'Auxil ext valve number 8', '1', 'Signed', '-125', '125', '-', '-', '', 'FMC650', 'ISOBUS']) +
      row(['124451', 'Auxil ext valve number 9', '1', 'Signed', '-125', '125', '-', '-', '', 'FMC650', 'ISOBUS']),
    ))
    expect(Object.keys(r.elements)).toEqual(['12450'])
    expect(r.warnings.some((w) => w.includes('124451') && w.includes('65535'))).toBe(true)
  })
})

describe('consensus: the cases the first version got wrong', () => {
  const e = (o: Partial<AvlEntry> & { name: string; type: string }): AvlEntry =>
    ({ bytes: '2', multiplier: '0.01*', units: '°C', min: '-4000', max: '4000', ...o })

  it('corrects a BLANK Type, not only the word "Unsigned"', () => {
    // Kept as defence, with its history corrected: the case that motivated this branch turned out to
    // be OUR parser dropping a `T<p>ype</p>` header, not the wiki leaving cells empty. With the
    // header fixed the branch fires on nothing in the real corpus. A genuinely blank cell is still
    // reconcilable, and this pins that behaviour rather than the story that was told about it.
    const src = { '25': e({ name: 'BLE Temperature #1', type: 'Signed' }) }
    const blank = { '25': e({ name: 'BLE Temperature #1', type: '' }) }
    const notes = applyTypeConsensus([src, blank])
    expect(blank['25'].type).toBe('Signed')
    expect(notes[0]!.note).toContain('was blank')
  })

  it('never rewrites a non-numeric type, which has no sign to correct', () => {
    const src = { '264': e({ name: 'Barcode ID', type: 'Signed' }) }
    const hex = { '264': e({ name: 'Barcode ID', type: 'HEX' }) }
    expect(applyTypeConsensus([src, hex])).toEqual([])
    expect(hex['264'].type).toBe('HEX')
  })

  it('the RANGE is part of the identity — same id, name and units but a different range is a different parameter', () => {
    // 156 signatures across the 34 tables resolve to entries with different ranges; without min/max
    // the rule was relying on luck rather than on the evidence its own comment cites.
    const a = { '13373': e({ name: 'Neighbouring Cell 1 MNC', type: 'Signed', min: '0', max: '999' }) }
    const b = { '13373': e({ name: 'Neighbouring Cell 1 MNC', type: 'Unsigned', min: '0', max: '99' }) }
    expect(applyTypeConsensus([a, b])).toEqual([])
    expect(b['13373'].type).toBe('Unsigned')
  })
})

describe('header shapes that actually occur on the wiki', () => {
  // Every fixture above uses ONE column order, so a positional parser passes them all — proved by
  // replacing headerIndex with hardcoded indices and watching 17/17 stay green. That is exactly why
  // two header defects shipped. These fixtures differ in ORDER and in SPELLING.

  it('reads a SHUFFLED column order — the whole point of matching on headers', () => {
    const html = `<table>
      <tr><th>Parameter Group</th><th>Property Name</th><th>Units</th><th>Property ID in AVL packet</th>
          <th>Type</th><th>Multiplier</th><th>Bytes</th></tr>
      <tr><td>CAN</td><td>Engine RPM</td><td>rpm</td><td>85</td><td>Unsigned</td><td>1</td><td>2</td></tr>
    </table>`
    expect(parseAvlTable(html).elements['85']).toEqual({
      name: 'Engine RPM', bytes: '2', type: 'Unsigned', multiplier: '1', units: 'rpm', group: 'CAN',
    })
  })

  it('reads a Type header broken up by markup — the wiki writes `T<p>ype</p>`', () => {
    // This exact cell exists on FMB150/FMC150/FMC250/FMM150/FMM250. An exact `h === 'type'` match
    // failed, every row in that table got type '', the "unrecognised Type" warning is guarded on a
    // NON-empty value so nothing was reported, and the consensus rule then "corrected" 164 blanks
    // this parser had itself created. Whitespace-stripped comparison is the fix.
    const html = `<table>
      <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>T<p>ype</p></th>
          <th colspan="2">Value range</th><th>Multiplier</th><th>Units</th></tr>
      <tr><th>Min</th><th>Max</th></tr>
      <tr><td>25</td><td>BLE Temperature #1</td><td>2</td><td>Signed</td><td>-4000</td><td>4000</td><td>0.01</td><td>°C</td></tr>
    </table>`
    expect(parseAvlTable(html).elements['25']?.type).toBe('Signed')
  })

  it('reads `Min Value | Max Value` and plain `Min | Max`, not only a spanned `Value range`', () => {
    // Three spellings exist across the 105 pages. Handling only the first left 1830 elements in 12
    // dictionaries with NO range at all and no warning — and the range is what the Type cross-check
    // and the consensus signature are built on, so a third of the corpus had no evidence behind it.
    for (const [minH, maxH] of [['Min Value', 'Max Value'], ['Min', 'Max']]) {
      const html = `<table>
        <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th>
            <th>${minH}</th><th>${maxH}</th><th>Multiplier</th><th>Units</th></tr>
        <tr><td>72</td><td>Dallas Temperature 1</td><td>4</td><td>Signed</td><td>-550</td><td>1150</td><td>0.1</td><td>°C</td></tr>
      </table>`
      const e = parseAvlTable(html).elements['72']
      expect(e?.min, minH).toBe('-550')
      expect(e?.max, minH).toBe('1150')
      expect(e?.multiplier, minH).toBe('0.1') // …and nothing shifted into the wrong column
    }
  })

  it('takes the Min/Max span from the MARKUP, so a colspan change cannot shift Multiplier into Units', () => {
    const html = `<table>
      <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th>
          <th colspan="3">Value range</th><th>Multiplier</th><th>Units</th></tr>
      <tr><td>84</td><td>Fuel Level</td><td>2</td><td>Unsigned</td><td>0</td><td>65535</td><td>x</td><td>0.1</td><td>l</td></tr>
    </table>`
    const e = parseAvlTable(html).elements['84']
    expect(e?.multiplier).toBe('0.1')
    expect(e?.units).toBe('l')
  })

  it('does not stop at a nested table inside a Description cell', () => {
    // A non-greedy /<table[\s\S]*?<\/table>/ ends the outer table at the first nested </table>.
    // The FM36 pages put a state-code table in row 12's Description, so the dictionary shipped 12
    // of 137 elements — no Ignition, no Movement, no Dallas temperatures — and warnings was empty.
    const html = `<table>
      <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th><th>Description</th></tr>
      <tr><td>69</td><td>GNSS Status</td><td>1</td><td>Unsigned</td>
          <td>codes:<table><tr><td>0</td><td>off</td></tr></table></td></tr>
      <tr><td>239</td><td>Ignition</td><td>1</td><td>Unsigned</td><td>0/1</td></tr>
    </table>`
    expect(Object.keys(parseAvlTable(html).elements).sort()).toEqual(['239', '69'])
  })

  it('…and the nested table does not shift the columns AFTER the Description cell either', () => {
    // Same defect one level down, and it survived the table-level fix: the CELL match was still
    // non-greedy, so the Description cell ended at the nested table's first </td> and the two
    // trailing columns slid left. With only the table level fixed, FM36 parsed to 137 elements — a
    // correct count — while 19 of them, including 239 Ignition and 240 Movement Sensor, carried the
    // NESTED table's text in HW Support and Parameter Group. A right-looking count is not a right
    // parse; that intermediate was measured, never committed.
    const html = `<table>
      <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th>
          <th>Description</th><th>HW Support</th><th>Parameter Group</th></tr>
      <tr><td>69</td><td>GNSS Status</td><td>1</td><td>Unsigned</td>
          <td>codes:<table><tr><td>0</td><td>off</td></tr></table>end</td>
          <td>FM3612, FM36M1</td><td>Permanent I/O elements</td></tr>
    </table>`
    const e = parseAvlTable(html).elements['69']
    expect(e?.hwSupport).toBe('FM3612, FM36M1')
    expect(e?.group).toBe('Permanent I/O elements')
    expect(e?.description).toBe('codes: 0 off end') // the whole cell, nested rows flattened
  })

  it('a row WIDER than the header is reported — the colspan handling alone does not defend', () => {
    // The "span comes from the markup" test above pins the arithmetic but not the protection: drop
    // the `colspan="2"` from `Value range` and `col += span` under-advances, so Multiplier is read
    // from the Max column and Units from Multiplier — a silent factor-of-ten in a customer-visible
    // number — while `warnings` stays empty, because the range cross-check reads the shifted cells
    // too. Zero rows on the live wiki are over-wide, so this cannot fire until it matters.
    const html = `<table>
      <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th>
          <th>Value range</th><th>Multiplier</th><th>Units</th></tr>
      <tr><th>Min</th><th>Max</th></tr>
      <tr><td>84</td><td>Fuel Level</td><td>2</td><td>Unsigned</td><td>0</td><td>65535</td><td>0.1</td><td>l</td></tr>
    </table>`
    const r = parseAvlTable(html)
    expect(r.warnings).toContain('id 84: row has 8 cells but the header declares 7 columns — column alignment is not guaranteed')
  })

  it('a commented-out closing tag does not close the table', () => {
    // The depth counter reads tag text, so `<!-- </table> -->` in a Description cell ends the table
    // there: every later row belongs to no match and the page parses to NOTHING, which main.ts
    // reports as "no AVL table found on the page" — a message a reader blames on the fetch.
    const html = `<table>
      <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th></tr>
      <tr><td>69</td><td>GNSS Status</td><td>1</td><td>Unsigned<!-- </table> --></td></tr>
      <tr><td>239</td><td>Ignition</td><td>1</td><td>Unsigned</td></tr>
    </table>`
    expect(Object.keys(parseAvlTable(html).elements).sort()).toEqual(['239', '69'])
  })

  it('`<td … />` is a START tag, per HTML5 — it must not blank a populated cell', () => {
    // Treating it as self-closing was tried and reverted: it dropped the cell's content while
    // keeping the cell COUNT, so nothing could detect it — and a blanked Type cell means every
    // negative temperature on that model reads as a large positive, which is the defect the
    // dictionary exists to prevent, arriving through a defence added for it.
    const html = `<table>
      <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th><th>Units</th></tr>
      <tr><td>84</td><td>Fuel Level</td><td class="x" />2</td><td>Signed</td><td>l</td></tr>
    </table>`
    const e = parseAvlTable(html).elements['84']
    expect(e?.bytes).toBe('2')
    expect(e?.type).toBe('Signed')
    expect(e?.units).toBe('l')
  })

  it('a data cell that SPANS is reported — reading by column index stops being sound there', () => {
    // The header legitimately spans (rowspan=2 over the Min/Max sub-header, colspan=2 on "Value
    // range"). A span in a DATA row is different: it slides every later column one place left, and
    // a multiplier read as units looks like data, not like a bug. Zero rows on the live wiki do this
    // today, so this exists to make the day one appears a reported event rather than a silent one.
    const html = `<table>
      <tr><th>Property ID in AVL packet</th><th>Property Name</th><th>Bytes</th><th>Type</th><th>Units</th></tr>
      <tr><td>84</td><td>Fuel Level</td><td rowspan="2">2</td><td>Unsigned</td><td>l</td></tr>
      <tr><td>85</td><td>Fuel Rate</td><td>1</td><td>Unsigned</td><td>l/h</td></tr>
    </table>`
    const r = parseAvlTable(html)
    expect(r.warnings).toContain('id 84: a data cell spans rows or columns — column alignment is not guaranteed for this row')
    expect(r.warnings.filter((w) => w.startsWith('id 85:'))).toEqual([]) // …and only the row that spans
  })
})
