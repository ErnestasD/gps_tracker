import { describe, expect, it } from 'vitest'

import { buildDictionary, loadDictionary, type DictionaryFile } from '../src/dictionaries.js'

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
})
