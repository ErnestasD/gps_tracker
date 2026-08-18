import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { EDITABLE_PARAMS, parseParameterList } from '../src/parseParams.js'

/**
 * The parameter-list parser reads the bounds we are about to put under a customer's slider, so a
 * mis-read row is not a cosmetic bug — it is a device configured out of contact. These tests pin
 * the shapes the real wiki actually serves, including the two that bit us.
 */

/** A row as the wiki emits it: id, type, default, min, max, value legend, name. */
const row = (...cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`
const page = (...rows: string[]) => `<div class="mw-parser-output">${'<table>' + rows.join('') + '</table>'}</div>`

describe('parseParameterList', () => {
  it('reads the bounds off a parameter row', () => {
    const { params, warnings } = parseParameterList(
      page(row('10050', 'Uint32', '300', '0', '2592000', 'Seconds', 'Min Period')),
    )
    expect(warnings).toEqual([])
    expect(params['10050']).toEqual({ default: '300', min: '0', max: '2592000', name: 'Min Period', value: 'Seconds' })
  })

  it('ignores every id we neither offer nor observe — including the ones that can strand a device', () => {
    // 2004 (server domain), 102 (power saving) and 11813 (GPS masking) are excluded BY DESIGN:
    // a customer can put a tracker permanently out of reach with any of them.
    const { params } = parseParameterList(page(
      row('2004', 'Char', '', '0', '55', 'String', 'Domain'),
      row('102', 'Uint8', '0', '0', '5', '0 – Disable', 'Power saving mode'),
      row('11813', 'Uint8', '1', '0', '2', '0 - No masking', 'GPS data masking'),
      row('10053', 'Uint8', '10', '0', '100', 'Seconds', 'Min Speed Delta'),
      row('10055', 'Uint32', '120', '0', '2592000', 'Seconds', 'Send Period'),
    ))
    // 10053 is deliberately NOT collected: FMB640/FMC650/FMM650 label it "Seconds" where the FT
    // pages treat it as a speed delta, and a unit we cannot state is one we must not print.
    expect(Object.keys(params)).toEqual(['10055'])
  })

  it('collects the roaming and unknown profiles too, so the artefact can be honest about them', () => {
    // These are NOT offered. They are recorded because both ship as 0 ("do not send") on most
    // models, and a customer roaming outside their home network is running THEM, not 10055.
    const { params } = parseParameterList(page(
      row('10155', 'Uint32', '0', '0', '2592000', 'Seconds', 'Send Period'),
      row('10255', 'Uint32', '0', '0', '2592000', 'Seconds', 'Send Period'),
    ))
    expect(params['10155']!.default).toBe('0')
    expect(params['10255']!.default).toBe('0')
  })

  it('skips a row whose bounds are not integers, and says so', () => {
    // String parameters state `""` as the default; a slider cannot be built from that.
    const { params, warnings } = parseParameterList(
      page(row('10050', 'Char', '""', '0', '32', 'String', 'Something textual')),
    )
    expect(params['10050']).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/non-numeric bounds/)
  })

  it('skips an inverted range rather than handing the UI min > max', () => {
    const { params, warnings } = parseParameterList(
      page(row('10052', 'Uint8', '10', '180', '0', 'Degrees', 'Min Angle')),
    )
    expect(params['10052']).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/min 180 > max 0/)
  })

  it('a short row (rowspan swallowed its cells) is reported, not guessed at', () => {
    const { params, warnings } = parseParameterList(page(row('10051', 'Uint16', '100')))
    expect(params['10051']).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/bounds unreadable/)
  })

  it('exactly five cells is refused — the last cell is the MAX, and would be recorded as the name', () => {
    const { params, warnings } = parseParameterList(page(row('10050', 'Uint32', '300', '0', '2592000')))
    expect(params['10050']).toBeUndefined()
    expect(warnings.join(' ')).toMatch(/bounds unreadable/)
  })

  it('a trailing rowspanned GROUP label is not mistaken for the parameter name', () => {
    // GH5200/TFT100/TMT250/TST100 end the row with "Home" — the name sits one column after the
    // legend, and `name` is the only signal a reviewer has that an id was mapped correctly.
    const { params } = parseParameterList(
      page(row('10050', 'Uint32', '300', '0', '2592000', 'Seconds', 'Min Period', 'Home')),
    )
    expect(params['10050']!.name).toBe('Min Period')
  })

  it('a duplicated id keeps the NARROWEST bounds — a value both tables agree the device accepts', () => {
    const { params, warnings } = parseParameterList(page(
      row('10000', 'Uint32', '3600', '0', '2592000', 'Seconds', 'Min Period'),
      row('10000', 'Uint32', '3600', '60', '86400', 'Seconds', 'Min Period'),
    ))
    expect(params['10000']).toMatchObject({ min: '60', max: '86400' })
    expect(warnings.join(' ')).toMatch(/kept the intersection/)
  })

  it('header rows and prose are not mistaken for parameters', () => {
    const { params } = parseParameterList(page(
      row('Parameter ID', 'Parameter Type', 'Default value', 'Value range', 'Value', 'Parameter name'),
      row('Min', 'Max'),
      row('10005', 'Uint32', '120', '0', '2592000', 'Seconds', 'Send Period'),
    ))
    expect(Object.keys(params)).toEqual(['10005'])
  })
})

/**
 * Against the REAL wiki HTML, committed rather than cached.
 *
 * These trimmed fixtures hold only the data-acquisition tables, verbatim from the pages. They are
 * committed on purpose: the previous version of this file read `tools/avl-dict/.cache`, which is
 * gitignored, so on CI the three tests that check the parser against reality silently vanished and
 * the suite could only confirm that the implementation agreed with the fixtures the same file built
 * from the layout the implementation assumes.
 *
 * The wiki spells the page two ways — `_Parameter_List` on the FT/AT platform, `_Parameter_list` on
 * the whole FMB generation — and honouring only the first reported 80 of 105 models as having no
 * parameters at all. Both spellings are represented here so that regression is loud.
 */
const fixture = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf8')

describe('against the real wiki HTML (committed fixtures)', () => {
  it('FTC887 (FT spelling) yields the defaults the hardware itself reported', () => {
    // Verified against the device over GPRS on 2026-08-18: getparam 10050 → 300, 10055 → 120,
    // 10000 → 3600, 10051 → 100. This checks the parser against reality rather than against
    // another copy of our own assumptions.
    const { params, warnings } = parseParameterList(fixture('ftc887-parameter-list.html'))
    expect(warnings).toEqual([])
    expect(params['10050']).toMatchObject({ default: '300', min: '0', max: '2592000' })
    expect(params['10051']).toMatchObject({ default: '100', max: '65535' })
    expect(params['10052']).toMatchObject({ default: '10', max: '180' })
    expect(params['10055']).toMatchObject({ default: '120' })
    expect(params['10000']).toMatchObject({ default: '3600' })
  })

  it('…and its ROAMING send period really does ship silent — the trap the settings UI must not hide', () => {
    const { params } = parseParameterList(fixture('ftc887-parameter-list.html'))
    expect(params['10155']!.default).toBe('0')
    expect(params['10105']!.default).toBe('0')
  })

  it('every offered id is found on a full FT page — a silent zero would ship an empty settings screen', () => {
    const { params } = parseParameterList(fixture('ftc887-parameter-list.html'))
    for (const id of Object.keys(EDITABLE_PARAMS)) expect(params[id], `id ${id}`).toBeDefined()
  })

  it('the FMB spelling parses too, with the same ids under different NAMES', () => {
    // "By time"/"Min Period" is the same parameter — which is why the catalogue keys on the id and
    // keeps the wiki's name only so a reviewer can spot a mis-mapped one.
    const { params, warnings } = parseParameterList(fixture('fmb120-parameter-list.html'))
    expect(warnings).toEqual([])
    expect(params['10050']).toMatchObject({ default: '300', min: '0', max: '2592000' })
    expect(params['10050']!.name).toMatch(/period/i)
    expect(params['10055']).toMatchObject({ default: '120' })
    for (const id of Object.keys(EDITABLE_PARAMS)) expect(params[id], `id ${id}`).toBeDefined()
  })
})
