import { describe, expect, it } from 'vitest'

import { applySign, buildDictionary, loadDictionary, type DictionaryFile } from '../src/dictionaries.js'

describe('AVL dictionaries (wiki-generated, PROJECT_PLAN §3.7)', () => {
  it('fmb1xx: core IDs match the wiki table', () => {
    const d = loadDictionary('fmb1xx')
    expect(d.size).toBeGreaterThan(300)
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
  })

  it('fmc: shares the FMB core (ignition/movement identical)', () => {
    const d = loadDictionary('fmc')
    expect(d.get(239)?.name).toBe('Ignition')
    expect(d.get(240)?.name).toBe('Movement')
    expect(d.size).toBeGreaterThan(300)
  })

  it('tat: asset-tracker list loads', () => {
    const d = loadDictionary('tat')
    expect(d.size).toBeGreaterThan(100)
    expect(d.get(1)?.name).toBe('Digital Input 1')
  })

  it('fmb6xx: stub loads empty (unknown IDs pass through downstream)', () => {
    expect(loadDictionary('fmb6xx').size).toBe(0)
  })

  it('every entry across all families has a non-empty name and valid id', () => {
    for (const family of ['fmb1xx', 'fmc', 'tat', 'fmb6xx'] as const) {
      for (const [id, entry] of loadDictionary(family)) {
        expect(Number.isInteger(id) && id >= 0 && id <= 0xffff, `${family}#${id}`).toBe(true)
        expect(entry.name.length, `${family}#${id}`).toBeGreaterThan(0)
      }
    }
  })

  it('repeated load returns the cached map (same reference)', () => {
    expect(loadDictionary('fmb1xx')).toBe(loadDictionary('fmb1xx'))
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
    const d = loadDictionary('fmb1xx')
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