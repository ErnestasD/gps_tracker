import { describe, expect, it } from 'vitest'
import xxhash from 'xxhash-wasm'

import { normalize } from '../src/normalize.js'

const hasher = await xxhash()
const hash = (d: Uint8Array): bigint => hasher.h64Raw(d)

const basePayload = {
  deviceId: 42n,
  imei: '356307042441013',
  serverTimeMs: Date.UTC(2026, 6, 4, 12, 0, 1),
  tsMs: Date.UTC(2026, 6, 4, 12, 0, 0),
  priority: 0,
  lat: 54.6872,
  lon: 25.2797,
  altitude: 120,
  angle: 90,
  satellites: 9,
  speed: 50,
  eventIoId: 0,
  io: [] as [number, bigint | number | Uint8Array][],
  raw: new Uint8Array([1, 2, 3]),
}

describe('normalize (E02-3)', () => {
  it('fix_valid = satellites > 0 (CLAUDE.md rule 6 / I5)', () => {
    expect(normalize({ ...basePayload, satellites: 9 }, hash).fixValid).toBe(true)
    expect(normalize({ ...basePayload, satellites: 0 }, hash).fixValid).toBe(false)
  })

  it('promotes ignition/movement/odometer (AVL 239/240/16) to columns', () => {
    const rec = normalize(
      { ...basePayload, io: [[239, 1n], [240, 0n], [16, 123456n]] },
      hash,
    )
    expect(rec.ignition).toBe(true)
    expect(rec.movement).toBe(false)
    expect(rec.odometerM).toBe(123456n)
  })

  it('missing IO ⇒ nulls (never guessed)', () => {
    const rec = normalize(basePayload, hash)
    expect(rec.ignition).toBeNull()
    expect(rec.movement).toBeNull()
    expect(rec.odometerM).toBeNull()
  })

  it('dictionary names known ids; unknown ids kept as io_<id> — never dropped (§3.7)', () => {
    const rec = normalize(
      { ...basePayload, io: [[21, 4n], [65535, 7n], [385, new Uint8Array([0xaa, 0xbb])]] },
      hash,
    )
    expect(rec.attrs['GSM Signal']).toBe(4)
    expect(rec.attrs['io_65535']).toBe(7)
    expect(rec.attrs['Beacon']).toBe('aabb') // variable payload as hex
  })

  it('rec_hash: unsigned xxhash64 > 2^63−1 reinterpreted as SIGNED bigint (§6.3 R10)', () => {
    // find a raw whose hash has the top bit set — proves the two's-complement path
    let raw: Uint8Array | null = null
    for (let i = 0; i < 1000; i++) {
      const candidate = new Uint8Array([i & 0xff, (i >> 8) & 0xff, 7])
      if (hasher.h64Raw(candidate) > 0x7fffffffffffffffn) {
        raw = candidate
        break
      }
    }
    expect(raw).not.toBeNull()
    const rec = normalize({ ...basePayload, raw: raw! }, hash)
    expect(rec.recHash).toBeLessThan(0n) // signed — fits PG bigint
    expect(BigInt.asUintN(64, rec.recHash)).toBe(hasher.h64Raw(raw!)) // lossless round-trip
  })

  it('course column carries the protocol angle (§6.3 naming note)', () => {
    expect(normalize({ ...basePayload, angle: 275 }, hash).course).toBe(275)
  })

  it('malformed payload throws (consumer dead-letters it)', () => {
    expect(() => normalize({ nonsense: true }, hash)).toThrow()
  })
})
