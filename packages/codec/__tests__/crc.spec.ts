import { describe, expect, it } from 'vitest'

import codec8 from '../__fixtures__/wiki/codec8.hex.json' with { type: 'json' }
import { crc16ibm } from '../src/crc16.js'
import { CrcError } from '../src/errors.js'
import { StreamFramer } from '../src/frame.js'
import { parseFrame } from '../src/parse.js'
import { hexBuf, type FixtureFile } from './helpers.js'

const ex1 = hexBuf((codec8 as FixtureFile).cases[0]!.hex)

describe('CRC-16/IBM', () => {
  it('matches the wiki example CRC (0x0000C7CF over CodecID..NumberOfData2)', () => {
    const dataLen = ex1.readUInt32BE(4)
    const span = ex1.subarray(8, 8 + dataLen)
    expect(crc16ibm(span)).toBe(0xc7cf)
    expect(ex1.readUInt32BE(8 + dataLen)).toBe(0xc7cf)
  })

  it('empty input → 0', () => {
    expect(crc16ibm(Buffer.alloc(0))).toBe(0)
  })

  it('corrupt packet → CrcError with the offending frame attached', () => {
    const bad = Buffer.from(ex1)
    bad[20] = bad[20]! ^ 0xff // flip a byte inside the CRC span
    const frames = new StreamFramer().feed(bad)
    try {
      parseFrame(frames[0]!)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CrcError)
      expect((err as CrcError).frame.equals(bad)).toBe(true)
    }
  })
})
