import { describe, expect, it } from 'vitest'

import {
  AMBIGUOUS_UNITS,
  CORRECTIONS,
  correctionFor,
  isReadableMultiplier,
  isScalingMultiplier,
  needsDeclaration,
  unitAfterMultiplierFor,
} from '../src/corrections.js'

describe('isScalingMultiplier: only a proven no-op is harmless', () => {
  it('an absent cell does not scale', () => {
    expect(isScalingMultiplier(undefined)).toBe(false)
  })

  it('exactly 1 does not scale, in either decimal convention the wiki uses', () => {
    for (const m of ['1', '1.0', '1,0', ' 1 ']) expect(isScalingMultiplier(m), m).toBe(false)
  })

  it('a real factor scales, comma or point — both occur inside ONE file', () => {
    for (const m of ['0.001', '0,001', '0.1', '0,1', '50']) expect(isScalingMultiplier(m), m).toBe(true)
  })

  it('a cell we CANNOT READ counts as scaling — the last thing to assume harmless', () => {
    // 129 cells in the corpus are not numbers: `0.01*` carries a footnote this code cannot read,
    // and treating the asterisk as decoration is how a tank reads 10× wrong.
    for (const m of ['0.01*', '0.1*', 'acc and braking: 0.01', '', 'n/a']) {
      expect(isScalingMultiplier(m), m).toBe(true)
    }
  })
})

/**
 * These cases are lifted from `parseMultiplier`'s own documentation in packages/codec. This package
 * has no dependencies by design, so the rule is written twice; if the two drift apart the failure is
 * silent — a declaration the generator accepts and the browser cannot apply.
 */
describe('isReadableMultiplier: in step with what the READER will accept', () => {
  it('accepts what parseMultiplier accepts — both decimal conventions', () => {
    for (const m of ['0.001', '0,001', '0.1', '50', '1', ' 0.01 ']) expect(isReadableMultiplier(m), m).toBe(true)
  })

  it('refuses what parseMultiplier refuses — the footnoted and the absent', () => {
    for (const m of ['0.01*', '0.1*', 'acc and braking: 0.01', '', 'n/a', '-1', '0', undefined]) {
      expect(isReadableMultiplier(m), String(m)).toBe(false)
    }
  })

  it('is NOT the same question as isScalingMultiplier — an unreadable cell is both', () => {
    // unreadable, so a reader cannot apply it → must not carry a unit CHANGE…
    expect(isReadableMultiplier('0.01*')).toBe(false)
    // …and unprovable as a no-op, so it still demands a decision
    expect(isScalingMultiplier('0.01*')).toBe(true)
    // × 1 is the mirror image: readable, and provably nothing to decide
    expect(isReadableMultiplier('1')).toBe(true)
    expect(isScalingMultiplier('1')).toBe(false)
  })
})

describe('needsDeclaration: the shape a human must decide', () => {
  it('is the SI-prefixed unit AND a scaling multiplier, never one alone', () => {
    expect(needsDeclaration('mV', '0.001')).toBe(true)
    expect(needsDeclaration('mV', '1')).toBe(false) // × 1 describes raw and result alike
    expect(needsDeclaration('mV', undefined)).toBe(false) // raw millivolts; the cell is the answer
    expect(needsDeclaration('V', '0.001')).toBe(false) // no prefix for a reader to rescale on
    expect(needsDeclaration(undefined, '0.001')).toBe(false)
  })

  it('covers every unit whose prefix invites a second rescale', () => {
    for (const u of AMBIGUOUS_UNITS) expect(needsDeclaration(u, '0.1'), u).toBe(true)
  })
})

describe('unitAfterMultiplierFor: three answers, and the difference matters', () => {
  it('an undeclared row is UNDEFINED — the generator refuses to write the file at all', () => {
    expect(unitAfterMultiplierFor('fmb120', '99999', 'mV')).toBeUndefined()
  })

  it('"converts away": the cell named the RAW unit, so the landing is the declared one', () => {
    // id 67 on the pages that still transclude the stale template: raw × 0.001 is VOLTS
    expect(unitAfterMultiplierFor('fm6300', '67', 'mV')).toBe('V')
    expect(unitAfterMultiplierFor('fmb010', '9', 'mV')).toBe('V')
  })

  it('"stated": the cell already describes the result, resolved against the row\'s own cell', () => {
    // ×50 mV is how a 400 V traction pack reports; the display's mV→V rescale is CORRECT here
    expect(unitAfterMultiplierFor('fmc650', '10879', 'mV')).toBe('mV')
    expect(unitAfterMultiplierFor('fmc650', '10880', 'mA')).toBe('mA')
    // the UL202 panel displays 285.2mm, so the wire value 2852 × 0.1 is already the mm figure
    expect(unitAfterMultiplierFor('fmb120', '327', 'mm')).toBe('mm')
  })

  it('a "stated" row with no cell to state is a REFUSAL, not an empty string', () => {
    expect(unitAfterMultiplierFor('fmc650', '10879', undefined)).toBeNull()
  })

  it('KEYED ON (table, id): 327 is a fuel level on one family and a GEOFENCE ZONE on the other', () => {
    expect(correctionFor('fmb120', '327')).toBeDefined()
    expect(correctionFor('fmc650', '327')).toBeUndefined() // "Geofence zone 21" — no unit, no claim
    expect(correctionFor('fmc650', '224')).toBeDefined() // …while 224 IS the fuel level here
    expect(correctionFor('fmb120', '224')).toBeUndefined() // and a geofence zone here
  })

  it('every declaration cites a source a reviewer can open (CLAUDE.md rule 8)', () => {
    expect(Object.keys(CORRECTIONS).length).toBeGreaterThan(50)
    for (const [k, c] of Object.entries(CORRECTIONS)) {
      // a BARE url: it is copied into the shipped dictionary, so it must be openable on its own and
      // must not smuggle prose (or an internal repo path) into a file that ships in a white-label product
      expect(c.source, k).toMatch(/^https:\/\/wiki\.teltonika-gps\.com\/view\/\S+$/)
      expect(c.source, k).not.toMatch(/\s/)
      expect(c.rule, k).toMatch(/^[A-Z][A-Z_]+$/)
      expect(c.reason.length, k).toBeGreaterThan(40)
    }
  })
})
