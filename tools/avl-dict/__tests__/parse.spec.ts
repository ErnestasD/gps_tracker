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
    ({ bytes: '2', multiplier: '0.1', units: '°C', ...o }) as AvlEntry

  it('corrects a page that says Unsigned when another page says Signed for the SAME definition', () => {
    // 141 Battery Temperature: Min −600 on all six pages that define it, yet four say Unsigned.
    // applySign compares Type exactly, so those four decode −60 °C as roughly 6553 °C.
    const a = { '141': entry({ name: 'Battery Temperature', type: 'Signed' }) }
    const b = { '141': entry({ name: 'Battery Temperature', type: 'Unsigned' }) }
    const notes = applyTypeConsensus([a, b])
    expect(b['141']!.type).toBe('Signed')
    expect(notes).toHaveLength(1)
  })

  it('leaves a J1939 offset parameter alone — no page claims it is signed', () => {
    // Coolant temperature reads Min −40 °C because it is offset-encoded, not signed. Marking it
    // Signed would corrupt ~34 CAN parameters in order to fix the two that are genuinely mislabelled.
    const a = { '1002': entry({ name: 'Engine Coolant Temperature', type: 'Unsigned', bytes: '1', multiplier: undefined }) }
    const b = { '1002': entry({ name: 'Engine Coolant Temperature', type: 'Unsigned', bytes: '1', multiplier: undefined }) }
    expect(applyTypeConsensus([a, b])).toEqual([])
    expect(a['1002']!.type).toBe('Unsigned')
  })

  it('does NOT unify ids that merely share a number — the definition has to match', () => {
    // id 141 is Battery Temperature on the FMx6xx tables and "Driver 1 Cumulative Break Time"
    // (minutes) on the FMB1xx one. Same number, unrelated parameters.
    const fmx = { '141': entry({ name: 'Battery Temperature', type: 'Signed' }) }
    const fmb = { '141': entry({ name: 'Driver 1 Cumulative Break Time', type: 'Unsigned', multiplier: undefined, units: 'min.' }) }
    expect(applyTypeConsensus([fmx, fmb])).toEqual([])
    expect(fmb['141']!.type).toBe('Unsigned')
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
