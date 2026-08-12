import { describe, expect, it } from 'vitest'

import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applySign, avlTables, buildDictionary, loadDictionary, tableForModel, type DictionaryFile } from '../src/dictionaries.js'

/** A scratch file inside the real dictionary directory, so the REAL load path is exercised. */
const probePath = (name: string): string => join(dirname(fileURLToPath(import.meta.url)), '..', 'dictionaries', name)

describe('AVL dictionaries (wiki-generated, PROJECT_PLAN §3.7)', () => {
  it('fmb120: the table 45 models share — core IDs match the wiki', () => {
    const d = loadDictionary('fmb120')
    expect(d.size).toBeGreaterThan(600) // the live table is 640; the old hand-made file had 323
    expect(d.get(239)?.name).toBe('Ignition')
    expect(d.get(240)?.name).toBe('Movement')
    expect(d.get(21)?.name).toBe('GSM Signal')
    expect(d.get(66)?.name).toBe('External Voltage')
    expect(d.get(66)?.multiplier).toBe('0.001')
    expect(d.get(66)?.units).toBe('V')
    expect(d.get(78)?.name).toBe('iButton')
    expect(d.get(78)?.bytes).toBe('8')
    expect(d.get(199)?.name).toBe('Trip Odometer')
    expect(d.get(385)?.name).toBe('Beacon')
    // the tachograph driver block, absent from the previous dictionary entirely
    expect(d.get(147)?.name).toBe('Driver 1 ID High')
  })

  it('THE SAME ID MEANS DIFFERENT THINGS ON DIFFERENT TABLES — this is why tables exist', () => {
    // Nothing selected a dictionary before: the parameter had a default and the one caller passed
    // undefined, so every device on the platform decoded against the FMB1xx table. A TAT asset
    // tracker reporting a tamper-detection event had it stored and shown as "Agricultural State
    // Flags P4", and a heart-rate alert as "Driver Name". A wrong name is worse than no name,
    // because a customer can act on it.
    const tat = loadDictionary('tat100')
    const fmb = loadDictionary('fmb120')
    expect(tat.get(520)?.name).toBe('Tamper detection Event')
    expect(fmb.get(520)?.name).toBe('Agricultural State Flags P4')
    expect(tat.get(403)?.name).toBe('Heart Rate Alert')
    expect(fmb.get(403)?.name).toBe('Driver Name')
  })

  it('resolves a model to its table, and 45 models share one', () => {
    expect(tableForModel('FMB120')).toBe('fmb120')
    expect(tableForModel('fmc130')).toBe('fmb120') // case-insensitive, and FMC130 renders the same table today
    expect(tableForModel('TAT100')).toBe('tat100')
    expect(tableForModel('FMC650')).toBe('fmc650')
    expect(tableForModel('NOT-A-MODEL')).toBeUndefined()
    expect(avlTables().length).toBeGreaterThan(20)
  })

  it('an UNKNOWN table is empty, never a throw and never another table', () => {
    // Substituting a neighbouring table is the defect this rewrite removes; throwing would take a
    // shard down over a naming mistake. Empty means every element still reaches attrs as io_<id>.
    expect(loadDictionary('no-such-table').size).toBe(0)
  })

  it('every entry in every table has a non-empty name and a wire-representable id', () => {
    // FMC650 lists one element as 124451 — an extra digit in 12451 — and an AVL id is 2 bytes, so
    // the generator drops it. If it ever reaches a dictionary, buildDictionary throws and the table
    // stops loading entirely, which is a far larger failure than one unnamed element.
    for (const table of avlTables()) {
      // …and the table must actually be THERE. Without this the empty-map fallback makes the loop
      // body never run, so deleting a shipped dictionary left this suite green — the one test that
      // walks every table could not detect a missing one.
      const d = loadDictionary(table)
      expect(d.size, `${table} is in the catalogue but ships no elements`).toBeGreaterThan(0)
      for (const [id, entry] of d) {
        expect(Number.isInteger(id) && id >= 0 && id <= 0xffff, `${table}#${id}`).toBe(true)
        expect(entry.name.length, `${table}#${id}`).toBeGreaterThan(0)
      }
    }
  })

  it('id 141 Battery Temperature is SIGNED on every table that defines it', () => {
    // Teltonika corrected this cell themselves (Template:FMX650 AVL ID rev 114084, 2026-06-05), but
    // the four pages that transclude the older FMX640 template still read Unsigned. Read unsigned,
    // −1.0 °C arrives as 6552.6 °C. The generator's cross-page consensus keeps the correction alive
    // through a regeneration; without this test that protection is invisible and easily deleted.
    for (const table of ['fm6300', 'fmb640', 'fmb641', 'fmc640', 'fmc650', 'fmm650']) {
      const e = loadDictionary(table).get(141)
      expect(e?.name, table).toBe('Battery Temperature')
      expect(e?.type, table).toBe('Signed')
    }
  })

  it('repeated load returns the cached map (same reference)', () => {
    expect(loadDictionary('fmb120')).toBe(loadDictionary('fmb120'))
  })

  it('rejects malformed dictionary files loudly', () => {
    const base: DictionaryFile = {
      family: 'x',
      source_url: 'https://wiki.teltonika-gps.com/view/X',
      retrieved_at: '2026-07-04',
      elements: { '1': { name: 'DIN1', bytes: '1', type: 'Unsigned' } },
    }
    expect(buildDictionary(base).get(1)?.name).toBe('DIN1')
    expect(() => buildDictionary({ ...base, source_url: 'https://example.com/x' })).toThrow(/wiki/)
    expect(() => buildDictionary({ ...base, retrieved_at: '' })).toThrow(/retrieved_at/)
    expect(() =>
      buildDictionary({ ...base, elements: { abc: { name: 'X', bytes: '1', type: 'U' } } }),
    ).toThrow(/invalid AVL id/)
    expect(() =>
      buildDictionary({ ...base, elements: { '70000': { name: 'X', bytes: '1', type: 'U' } } }),
    ).toThrow(/invalid AVL id/)
    expect(() =>
      buildDictionary({ ...base, elements: { '2': { name: '', bytes: '1', type: 'U' } } }),
    ).toThrow(/no name/)
  })

  it('applySign reinterprets SIGNED parameters at their own width (audit MED)', () => {
    // The wire carries raw bytes; the dictionary's Type column is what says how to read them. With
    // nothing applying it, all 36 signed FMB1xx parameters surfaced as unsigned — a −5 °C coolant
    // or BLE temperature read as 251, an accelerometer axis swinging negative as ~65 000 — in the
    // UI, in exports, and in any rule threshold built on them. A "below −10 °C" cold-chain alert
    // could never fire, because the value it compares was never negative.
    // https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
    const d = loadDictionary('fmb120')
    expect(d.get(32)?.type).toBe('Signed') // Coolant Temperature, 1 byte
    expect(applySign(d.get(32), 251n)).toBe(-5n)
    expect(applySign(d.get(32), 25n)).toBe(25n) // a positive reading is untouched
    expect(d.get(17)?.type).toBe('Signed') // Axis X, 2 bytes
    expect(applySign(d.get(17), 65_531n)).toBe(-5n) // …and at ITS width, not the 1-byte one
    expect(d.get(239)?.type).toBe('Unsigned') // Ignition
    expect(applySign(d.get(239), 251n)).toBe(251n) // unsigned parameters must not be touched
  })

  it('applySign never guesses: an unknown id, an unknown width, or an already-negative value pass through', () => {
    // Guessing is how a correct reading becomes a wrong one — and every one of these is a shape a
    // future dictionary revision could introduce.
    const entry = { name: 'X', bytes: '3', type: 'Signed' as const }
    expect(applySign(entry, 200n)).toBe(200n) // 3-byte width is not in the table
    expect(applySign(undefined, 200n)).toBe(200n) // id absent from the dictionary
    expect(applySign({ name: 'X', bytes: '1', type: 'Signed' }, -5n)).toBe(-5n) // already signed
  })
})

describe('loading is defensive in the two ways that matter', () => {
  it('a CORRUPT shipped dictionary throws from loadDictionary, not just from buildDictionary', () => {
    // The empty-map path is for a table we do not ship. A shipped file that is truncated or
    // unreadable must be loud: swallowing it strips every name AND every sign fleet-wide, and
    // `applySign` on an absent entry is a pass-through, so temperatures read as large positives.
    // The previous test called buildDictionary directly and never exercised this path at all.
    const path = probePath('zz-corrupt-probe.json')
    writeFileSync(path, '{ "table": "zz-corrupt-probe", "elements": {')
    try {
      expect(() => loadDictionary('zz-corrupt-probe')).toThrow()
    } finally {
      rmSync(path, { force: true })
    }
  })

  it('an UNREADABLE shipped dictionary throws too — only ENOENT means "not shipped"', () => {
    // This is the case the previous test does NOT reach: a readable-but-corrupt file throws from
    // JSON.parse regardless of how the catch is written, so only a genuine read FAULT exercises the
    // ENOENT discrimination. Without it, a permission or I/O error decodes a whole fleet as io_<id>.
    const path = probePath('zz-unreadable-probe.json')
    writeFileSync(path, '{}')
    chmodSync(path, 0o000)
    try {
      if (process.getuid?.() === 0) return // root ignores the mode bits; nothing to assert
      expect(() => loadDictionary('zz-unreadable-probe')).toThrow()
    } finally {
      chmodSync(path, 0o600)
      rmSync(path, { force: true })
    }
  })

  it('a MALFORMED dictionary throws — it is a bug in our generator, not a missing table', () => {
    // The empty-map fallback exists for a table we do not ship. A table we DO ship that fails
    // validation (a bad id, a nameless entry, a missing source_url) must be loud: silently decoding
    // that model's whole fleet as io_<id> would look identical to the devices being broken.
    const bad = { table: 'x', source_url: 'https://wiki.teltonika-gps.com/view/X', retrieved_at: '2026-01-01', elements: { '1': { name: '', bytes: '1', type: 'Unsigned' } } }
    expect(() => buildDictionary(bad as unknown as DictionaryFile)).toThrow(/has no name/)
  })

  it('applySign leaves a value alone when the entry cannot say how wide it is', () => {
    // bytes is not validated at build time, and this runs on the ordered pipeline — a future entry
    // without it must not throw a TypeError there, and must not guess a width either.
    expect(applySign({ name: 'x', bytes: undefined as unknown as string, type: 'Signed' }, 250n)).toBe(250n)
    expect(applySign({ name: 'x', bytes: '3', type: 'Signed' }, 250n)).toBe(250n) // 3 bytes: no AVL width
  })
})
