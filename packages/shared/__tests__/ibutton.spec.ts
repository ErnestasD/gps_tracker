import { describe, expect, it } from 'vitest'

import { ibuttonKeyFromAvl, ibuttonKeyFromHex } from '../src/entities.js'

describe('V2 iButton canonical keys', () => {
  it('a hex key and its decimal AVL value reduce to the SAME canonical key', () => {
    // 0x00A1B2C3D4 = 2_712_847_316 ; leading zeros + case must not matter
    expect(ibuttonKeyFromHex('00A1B2C3D4')).toBe('2712847316')
    expect(ibuttonKeyFromHex('a1b2c3d4')).toBe('2712847316')
    expect(ibuttonKeyFromAvl(2712847316)).toBe('2712847316')
    expect(ibuttonKeyFromAvl('2712847316')).toBe('2712847316')
    expect(ibuttonKeyFromHex('00A1B2C3D4')).toBe(ibuttonKeyFromAvl(2712847316))
  })

  it('handles 64-bit ids beyond JS number precision (decimal string)', () => {
    // a full 8-byte Dallas id > 2^53
    const hex = '01000000A1B2C3D4'
    const dec = BigInt('0x' + hex).toString()
    expect(ibuttonKeyFromHex(hex)).toBe(dec)
    expect(ibuttonKeyFromAvl(dec)).toBe(dec)
  })

  it('rejects garbage / no-key values', () => {
    expect(ibuttonKeyFromHex('')).toBeNull()
    expect(ibuttonKeyFromHex('xyz')).toBeNull()
    expect(ibuttonKeyFromAvl(0)).toBeNull() // 0 = no key attached
    expect(ibuttonKeyFromAvl('0')).toBeNull()
    expect(ibuttonKeyFromAvl(null)).toBeNull()
    expect(ibuttonKeyFromAvl(undefined)).toBeNull()
    expect(ibuttonKeyFromAvl('nope')).toBeNull()
    expect(ibuttonKeyFromAvl({})).toBeNull()
  })
})
