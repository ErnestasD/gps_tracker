import { describe, expect, it } from 'vitest'

import { normalizeIbutton } from '../src/lib/drivers'

describe('V2 driver helpers', () => {
  it('normalizeIbutton: empty → null, valid hex → upper-case, else false', () => {
    expect(normalizeIbutton('')).toBeNull()
    expect(normalizeIbutton('   ')).toBeNull()
    expect(normalizeIbutton('a1b2c3d4')).toBe('A1B2C3D4')
    expect(normalizeIbutton('  DEADBEEF01  ')).toBe('DEADBEEF01')
    expect(normalizeIbutton('short')).toBe(false) // non-hex
    expect(normalizeIbutton('A1B2')).toBe(false) // too short (<8)
    expect(normalizeIbutton('G1B2C3D4')).toBe(false) // G is not hex
    expect(normalizeIbutton('A'.repeat(33))).toBe(false) // too long (>32)
  })
})
