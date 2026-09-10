import { describe, expect, it } from 'vitest'

import { isLuhnValid, packageName, pseudonymFor, redact } from './index.js'

describe('@orbetra/redact', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@orbetra/redact')
  })
})

/**
 * The tool exists to satisfy hard rule 12, and a redactor that is merely enthusiastic is worse than
 * none: it either leaves a real identifier behind, or it rewrites bytes a CRC covers and hands
 * somebody a fixture that cannot verify. Both directions are tested here.
 */
describe('IMEI detection', () => {
  it('accepts a real IMEI and rejects a 15-digit number that is not one', () => {
    expect(isLuhnValid('356307042441013')).toBe(true) // Luhn-valid, from the public research corpus
    expect(isLuhnValid('123456789012345')).toBe(false) // the number everybody types as an example
    expect(isLuhnValid('35630704244101')).toBe(false) // 14 digits is not an IMEI
  })

  it('leaves a non-IMEI 15-digit run untouched — a timestamp in microseconds is not an identifier', () => {
    const text = 'seq 123456789012345 at 1562760414000000'
    expect(redact(text).text).toBe(text)
  })
})

describe('pseudonyms', () => {
  it('are deterministic, so one device stays one device across a whole corpus', () => {
    expect(pseudonymFor('356307042441013')).toBe(pseudonymFor('356307042441013'))
  })

  it('are themselves valid IMEIs, so a fixture that checks the digit still passes', () => {
    const p = pseudonymFor('356307042441013')
    expect(p).toHaveLength(15)
    expect(isLuhnValid(p)).toBe(true)
  })

  it('do not collide for different inputs', () => {
    const a = pseudonymFor('356307042441013')
    const b = pseudonymFor('358899050927725')
    expect(a).not.toBe(b)
  })

  it('are obviously synthetic to a human reading a fixture', () => {
    expect(pseudonymFor('356307042441013').startsWith('35000000')).toBe(true)
  })
})

describe('redact', () => {
  it('replaces a decimal IMEI in prose and records the mapping', () => {
    const r = redact('device 356307042441013 reported at 12:00')
    expect(r.text).not.toContain('356307042441013')
    expect(r.text).toContain(pseudonymFor('356307042441013'))
    expect(r.replaced.get('356307042441013')).toBe(pseudonymFor('356307042441013'))
  })

  it('replaces every occurrence of the same device with the same pseudonym', () => {
    const r = redact('356307042441013 … later … 356307042441013')
    const p = pseudonymFor('356307042441013')
    expect(r.text).toBe(`${p} … later … ${p}`)
  })

  /**
   * The property that matters most. A Teltonika handshake carries the IMEI as ASCII inside the
   * frame and the frame is CRC-covered; a GT06 login carries it as BCD. Rewriting those digits
   * produces a capture that no longer verifies — a fixture that lies is worse than a fixture that
   * embarrasses us, so the tool reports and refuses.
   */
  it('never rewrites bytes inside a hex frame — it reports them instead', () => {
    const ascii = '000F' + Buffer.from('356307042441013', 'ascii').toString('hex').toUpperCase()
    const r = redact(`handshake ${ascii} ok`)
    expect(r.text).toBe(`handshake ${ascii} ok`) // bytes untouched: the CRC still covers what it covered
    expect(r.inFrame.map((f) => f.imei)).toContain('356307042441013')
    // BOTH readings are reported, and that is correct rather than sloppy: an ASCII IMEI in hex is
    // written entirely in digit characters, so the same bytes are a valid BCD reading too. The tool
    // hands a human every reading it can defend instead of picking one and hiding the other.
    expect(r.inFrame.some((f) => f.imei === '356307042441013' && f.encoding === 'ascii')).toBe(true)
  })

  it('finds a BCD-encoded IMEI in a frame and leaves the frame alone', () => {
    const frame = '78780D01' + '0356307042441013' + '0001' + 'ABCD'
    const r = redact(`login ${frame}`)
    expect(r.text).toBe(`login ${frame}`)
    expect(r.inFrame.some((f) => f.imei === '356307042441013' && f.encoding === 'bcd')).toBe(true)
  })

  it('reports nothing and changes nothing for a text with no identifiers', () => {
    const r = redact('CRC-16/KERMIT over bytes 2..1021 checks out')
    expect(r.replaced.size).toBe(0)
    expect(r.inFrame).toEqual([])
  })
})
