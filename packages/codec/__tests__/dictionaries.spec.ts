import { describe, expect, it } from 'vitest'

import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { applySign, avlTables, buildDictionary, loadDictionary, tableForModel, type AvlDictionaryEntry, type DictionaryFile } from '../src/dictionaries.js'

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

  it('no table has silently SHRUNK — a truncated parse ships a plausible-looking dictionary', () => {
    // `size > 0` was the only quality gate the shipped artefact had, and a 12-of-137 `fm36` passed
    // it: a non-greedy table match ended the FM36 table at a nested <table> in a Description cell,
    // and the missing 125 elements — Ignition, Movement, the Dallas temperatures, the odometer —
    // simply surfaced as io_<id>, which reads to a customer like the DEVICE being broken. The
    // generator has its own shrink guard, but that only fires when someone regenerates; this
    // protects the FILES, which a hand-edit or a bad merge can also mangle.
    //
    // Floors are 90% of the count at capture (2026-08-12), so ordinary wiki churn never touches
    // them and only a collapse does. Lowering one is a deliberate act that belongs in a diff: check
    // the wiki page actually lost those rows before you do it.
    const FLOOR: Record<string, number> = {
      fmc650: 1077, fmm650: 844, fmc640: 842, fmb640: 801, fmb641: 682, fmb120: 576, fmb930: 499, tft100: 492,
      fmc150: 379, fmb150: 378, fmm150: 378, fmb001: 313, fmc250: 309, tst100: 265, ftc305: 244, fm6300: 238,
      gh5200: 231, tat100: 216, fmc880: 214, fmm880: 213, ftc308: 191, ftc164: 189, fmb010: 187, ftc134: 186,
      fmm80a: 185, ftc927: 176, ftc924: 173, ftc887: 171, fm36: 123, ftc920: 72, atc704: 69, ftm927: 68,
      atc700: 36,
      // 2026-09-03: Teltonika's pages regrouped and `atc774` stopped being a table of its own —
      // ATC774 now matches atc700's content, while FTC880/FTC881/FTM880 split off into `ftc880`
      // and FTC921/FTC965 out of their old families. Verified against the pages before accepting
      // the remap: each parses fully (40/75/81/193 elements), none is a truncation. The three new
      // floors are 90% of the count at that capture, like every other entry here.
      ftc880: 67, ftc921: 72, ftc965: 173,
    }
    // …and the map must COVER the catalogue. Without this a new table added with a truncated parse
    // gets no floor at all and the loop above waves it through — which is exactly the case the
    // generator's own guard cannot see either, because there is no previous file to compare to.
    expect(avlTables().slice().sort()).toEqual(Object.keys(FLOOR).sort())
    for (const table of avlTables()) {
      expect(loadDictionary(table).size, `${table} lost elements`).toBeGreaterThanOrEqual(FLOOR[table]!)
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

  it('an UNSIGNED entry is never reinterpreted, whatever its documented range says', () => {
    // The Type check was the ONE applySign rule with no test: removing it left all 119 codec tests
    // green while 34 real corpus entries changed value. The existing probe could not see it —
    // fmb120's id 239 has min "0", so the non-negative-min guard refuses it first and the Type
    // check is never the reason it passes.
    //
    // id 1333 "Steering wheel turn counter" is the case that discriminates: Unsigned, 1 byte, and
    // the wiki documents its range as −32…29 — negative, so the min guard lets it through, and
    // narrow, so the offset guard does not fire either. Only the Type check stands between a wire
    // 200 and −56. It is a real row on fmb150/fmc150/fmc250/fmm150.
    const turnCounter = { name: 'Steering wheel turn counter', bytes: '1', type: 'Unsigned', min: '-32', max: '29' }
    expect(applySign(turnCounter, 200n)).toBe(200n)
    expect(BigInt.asIntN(8, 200n)).toBe(-56n) // …which is what it would become
    expect(applySign(loadDictionary('fmb150').get(1333), 200n)).toBe(200n) // and on the real entry

    // …and across the whole corpus: nothing the wiki types as anything but Signed is ever rewritten.
    const BITS: Record<string, number> = { '1': 8, '2': 16, '4': 32, '8': 64 }
    const rewritten: string[] = []
    for (const table of avlTables()) {
      for (const [id, e] of loadDictionary(table)) {
        if (e.type === 'Signed') continue
        const bits = BITS[(e.bytes ?? '').trim()]
        if (bits === undefined) continue
        const probe = (1n << BigInt(bits)) - 56n
        if (applySign(e, probe) !== probe) rewritten.push(`${table}#${id} ${e.name} (${e.type})`)
      }
    }
    expect(rewritten).toEqual([])
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

describe('applySign refuses what it cannot honestly reinterpret', () => {
  it('passes a value WIDER than the declared width through untouched', () => {
    // BigInt.asIntN truncates rather than declining. Until profile → table is wired every device
    // decodes against fmb120, which correctly describes 45 of 105 models, and eight ids are Signed
    // there at a NARROWER width than another shipped table gives them. Measured on the real path:
    // 5000 against a 1-byte Signed entry came out as −120 and was written durably to attrs.
    const oneByte = { name: 'Coolant Temperature', bytes: '1', type: 'Signed', min: '-128', max: '127' }
    expect(applySign(oneByte, 5000n)).toBe(5000n) // odd, and visibly so — not plausible and wrong
    expect(applySign(oneByte, 251n)).toBe(-5n) // …while a genuine 1-byte reading still works
  })

  it('refuses a range the width says is impossible — an OFFSET encoding is not two\'s complement', () => {
    // Teltonika types id 127 Engine Coolant Temperature as Signed, 1 byte, −40…210, described
    // "Offset by -40": the wire byte is 0…250 and the value is byte − 40. 210 does not fit int8.
    // Reinterpreting turns a 130 °C engine (byte 170) into −86 °C, so an over-temp rule can never
    // fire. 12 entries across the shipped tables have this shape; fmb120 has none, so they arm the
    // moment a device is decoded with its own table.
    const offset = { name: 'Engine Coolant Temperature', bytes: '1', type: 'Signed', min: '-40', max: '210' }
    expect(applySign(offset, 170n)).toBe(170n)
  })

  it('…but an OFF-BY-ONE max on a genuinely signed field is NOT an offset encoding', () => {
    // The refusal above first tested `max` alone, and review caught it: that silenced sign
    // extension on 64 entries — every ELD, reefer and Frigo temperature on the FMx6xx tables —
    // because the wiki writes their range as −32768…32768 and 32768 is one past int16. A field
    // whose own Min is EXACTLY the signed floor is two's complement whatever its Max says, and
    // passing it through turns −5.0 °C into 65486: the precise failure applySign exists to stop,
    // armed by the same commit that made these tables reachable.
    //
    // The signature of a real offset encoding is the WHOLE range, not one end — the span fits the
    // UNSIGNED width and the minimum sits above the signed floor. These four cover both sides of
    // each half of that test.
    const frigo = { name: 'Frigo Comp 1 Supply', bytes: '2', type: 'Signed', min: '-32768', max: '32768' }
    expect(applySign(frigo, 0xffcen)).toBe(-50n) // −5.0 °C, not 65486
    const slope = { name: 'LVCAN Slope of Arm', bytes: '2', type: 'Signed', min: '-65535', max: '65535' }
    expect(applySign(slope, 0xffffn)).toBe(-1n) // span 131070 > 65535: not an offset either
    // …while both genuine shapes still refuse: a real offset, and a range that is plainly unsigned
    expect(applySign({ name: 'HV Battery Temperature', bytes: '1', type: 'Signed', min: '-40', max: '210' }, 250n)).toBe(250n)
    expect(applySign({ name: 'Sensor 7 Unit', bytes: '1', type: 'Signed', min: '0', max: '255' }, 200n)).toBe(200n)
  })

  it('an IDENTIFIER typed Signed is not sign-extended — a min of 0 has no sign to extend', () => {
    // Round two found this in round one's fix. fm36 types eleven EIGHT-BYTE fields `Signed` with
    // min "0" and an unreadable max ("max", "-1E+19"): 78 iButton ID, the Dallas sensor IDs, the
    // LVCAN driver IDs, ModuleID and two flag words. Those are identifiers and bitmasks, and the
    // predicate — which demanded a READABLE range before refusing — treated the garbage max as
    // permission to reinterpret. An iButton ROM with the high bit set came out negative, so about
    // half of all ROM codes were corrupted durably in attrs, breaking driver assignment.
    //
    // The sharpest part: fmb120, the "wrong" fallback table, decoded it CORRECTLY. Naming the
    // device's true model made its data worse, which is the exact opposite of the point.
    const rom = 0x8b0000021c4a2801n
    const ibutton = { name: 'iButton ID', bytes: '8', type: 'Signed', min: '0', max: '-1E+19' }
    expect(applySign(ibutton, rom)).toBe(rom)
    expect(applySign({ name: 'LVCAN Driver1 ID High', bytes: '8', type: 'Signed', min: '0', max: 'max' }, rom)).toBe(rom)
    // …and the real fm36 entry, not just a hand-built one
    expect(applySign(loadDictionary('fm36').get(78), rom)).toBe(rom)
    expect(applySign(loadDictionary('fmb120').get(78), rom)).toBe(rom) // the fallback always agreed
  })

  it('a range we cannot READ is left alone rather than reinterpreted on the Type column alone', () => {
    // The corpus really does carry `max: "max"`, `max: "9,9"`, `min: "0 bytes"` and
    // `max: "4211081.215 l"`. Type is one word; the range is the evidence. With no readable
    // negative minimum there is nothing to justify rewriting the bytes.
    expect(applySign({ name: 'X', bytes: '2', type: 'Signed', max: '9,9' }, 65_531n)).toBe(65_531n)
    expect(applySign({ name: 'X', bytes: '2', type: 'Signed', min: '0 bytes', max: '100' }, 65_531n)).toBe(65_531n)
    // …while a readable negative minimum still gets the reinterpretation it asks for
    expect(applySign({ name: 'X', bytes: '2', type: 'Signed', min: '-32768', max: '32767' }, 65_531n)).toBe(-5n)
  })

  it('the refusals over the REAL corpus are exactly these, and each for a stated reason', () => {
    // The unit cases pin the rules; this pins the BLAST RADIUS, which is what went wrong twice —
    // a rule that looked right hit 76 entries instead of 12, and its replacement missed 18.
    // Split by reason so a change shows up as a MOVE between lists, not as a bare count.
    const BITS: Record<string, number> = { '1': 8, '2': 16, '4': 32, '8': 64 }
    const nonNegative: string[] = []
    const offsetEncoded: string[] = []
    for (const table of avlTables()) {
      for (const [id, e] of loadDictionary(table)) {
        if (e.type !== 'Signed') continue
        const bits = BITS[(e.bytes ?? '').trim()]
        if (bits === undefined) continue
        // a positive reading inside the declared width that comes back UNCHANGED was refused
        const probe = (1n << BigInt(bits)) - 2n
        if (applySign(e, probe) !== probe) continue
        const min = Number(e.min)
        ;(Number.isFinite(min) && min < 0 ? offsetEncoded : nonNegative).push(`${table}#${id} ${e.name}`)
      }
    }
    // identifiers, bitmasks, a presence bit and two unit codes — none of them a quantity that can
    // go negative. `fm36#115 LVCAN Engine Temperature` used to be on this list, and it was the
    // proof that a count is not a check: it IS a quantity that goes negative, FM36's page just
    // writes the wire range instead of the value range. applyRangeConsensus now repairs it from
    // the six tables that document the same parameter as −600…1270.
    expect(nonNegative.sort()).toEqual([
      'fm36#101 LVCAN ModuleID',
      'fm36#124 LVCAN Agricultural Machinery Flags',
      'fm36#132 LVCAN Security State Flags',
      'fm36#147 LVCAN Driver1 ID High',
      'fm36#148 LVCAN Driver1 ID Low',
      'fm36#149 LVCAN Driver2 ID High',
      'fm36#150 LVCAN Driver2 ID Low',
      'fm36#75 Dallas Temperature Sensor ID1',
      'fm36#76 Dallas Temperature Sensor ID2',
      'fm36#77 Dallas Temperature Sensor ID3',
      'fm36#78 iButton ID',
      'fmc650#13378 Sensor 7 Unit',
      // 2026-09-03: six more of the same shape. Cross-page ADOPTION (an element is now taken from
      // another Teltonika page when that page's HW Support column names this exact model) brought
      // the DDI block onto fmc650, and these six declare a negative minimum on a width that cannot
      // carry it — the identical reason `13378 Sensor 7 Unit` above is refused. Refusing is the
      // point: the alternative is a rewritten byte width on a number a customer reads.
      'fmc650#14332 DDI Setpoint Mass Per Area Application Rate',
      'fmc650#14333 DDI Actual Mass Per Area Application Rate',
      'fmc650#14334 DDI Setpoint Volume Content',
      'fmc650#14335 DDI Actual Volume Content',
      'fmc650#14336 DDI Actual Volume Per Area Application Rate ml m2',
      'fmc650#14337 DDI Actual Working Length',
      'fmm650#13378 Sensor 7 Unit',
      'ftc134#1474 Beacon Presence',
      'ftc164#1474 Beacon Presence',
      'ftc305#1474 Beacon Presence',
      'ftc308#1474 Beacon Presence',
      'ftc887#1474 Beacon Presence',
      'ftc924#1474 Beacon Presence',
      'ftc927#1474 Beacon Presence',
      // `ftc965` is a table that did not exist before the regrouping and `ftm927` gained 1474 by
      // adoption — the same Beacon Presence refusal as the seven lines above, not a new class.
      'ftc965#1474 Beacon Presence',
      'ftm927#1474 Beacon Presence',
    ])
    // …and the genuine SAE J1939 offset encodings: −40…210 on a byte whose wire range is 0…250
    expect(offsetEncoded.sort()).toEqual([
      'fm6300#127 Engine Coolant Temperature',
      'fmb640#127 Engine Coolant Temperature',
      'fmb641#10893 High Voltage Battery Temperature',
      'fmb641#127 Engine Coolant Temperature',
      // 2026-09-03: cross-page adoption brought 10893 onto fmc640 as well — the same −40…210 J1939
      // offset already listed for fmb641/fmc650/fmm650, on the same element, not a new shape.
      'fmc640#10893 High Voltage Battery Temperature',
      'fmc640#127 Engine Coolant Temperature',
      'fmc650#10893 High Voltage Battery Temperature',
      'fmc650#127 Engine Coolant Temperature',
      'fmm650#10893 High Voltage Battery Temperature',
      'fmm650#127 Engine Coolant Temperature',
    ])
  })

  it('THE INVARIANT: naming a device\'s true model never decodes worse than the fallback', () => {
    // This is what the whole per-model dictionary effort is for, and it has been broken twice —
    // once by sign-extending iButton IDs, once by REFUSING an engine temperature. Both times the
    // symptom was the same and absurd: the "wrong" fmb120 fallback read the value correctly while
    // the device's own table did not. So state the invariant executably instead of trusting that
    // each rule's blast radius was checked.
    //
    // Compared per PARAMETER, not per id: id 18 is "Fuel Rate" (Unsigned, l/h) on fmb640 and
    // "Axis Y" (Signed, mG) on fmb120 — genuinely different things sharing a number, and the
    // fallback being wrong about that is the defect this module removes, not a violation. Same id,
    // same width, same multiplier, same units and Signed on both sides is the same parameter.
    const BITS: Record<string, number> = { '1': 8, '2': 16, '4': 32, '8': 64 }
    const key = (id: number, e: { bytes: string; multiplier?: string; units?: string }): string =>
      `${id}|${e.bytes}|${e.multiplier ?? ''}|${e.units ?? ''}`
    const rows: [string, number, AvlDictionaryEntry][] = []
    for (const table of avlTables()) for (const [id, e] of loadDictionary(table)) rows.push([table, id, e])

    const widened = (e: AvlDictionaryEntry, bits: number): boolean => applySign(e, (1n << BigInt(bits)) - 5n) !== (1n << BigInt(bits)) - 5n
    const extendsIt = new Map<string, string>()
    for (const [table, id, e] of rows) {
      if (e.type !== 'Signed') continue
      const bits = BITS[(e.bytes ?? '').trim()]
      if (bits !== undefined && widened(e, bits)) extendsIt.set(key(id, e), `${table}#${id} ${e.name}`)
    }
    const disagreements: string[] = []
    for (const [table, id, e] of rows) {
      if (e.type !== 'Signed') continue
      const bits = BITS[(e.bytes ?? '').trim()]
      if (bits === undefined || widened(e, bits)) continue
      const other = extendsIt.get(key(id, e))
      if (other !== undefined) disagreements.push(`${table}#${id} "${e.name}" (${String(e.min)}..${String(e.max)}) refuses, but ${other} extends`)
    }
    expect(disagreements).toEqual([])
  })

  it('entries are frozen — one mutation would poison every shard for the process lifetime', () => {
    const e = loadDictionary('fmb120').get(21)!
    expect(Object.isFrozen(e)).toBe(true)
    expect(() => { (e as { name: string }).name = 'PWNED' }).toThrow()
    expect(loadDictionary('fmb120').get(21)?.name).toBe('GSM Signal')
  })
})
