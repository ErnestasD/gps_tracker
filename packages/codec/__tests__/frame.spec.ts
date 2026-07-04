import { describe, expect, it } from 'vitest'

import codec8 from '../__fixtures__/wiki/codec8.hex.json' with { type: 'json' }
import handshake from '../__fixtures__/wiki/handshake.hex.json' with { type: 'json' }
import { FrameError } from '../src/errors.js'
import { StreamFramer } from '../src/frame.js'
import { hexBuf, type FixtureFile } from './helpers.js'

const ex1 = hexBuf((codec8 as FixtureFile).cases[0]!.hex)
const imeiFrame = hexBuf((handshake as FixtureFile).cases[0]!.hex)

describe('StreamFramer', () => {
  it('extracts a whole packet from a single chunk', () => {
    const frames = new StreamFramer().feed(ex1)
    expect(frames).toHaveLength(1)
    expect(frames[0]!.kind).toBe('avl')
    expect(frames[0]!.bytes.equals(ex1)).toBe(true)
  })

  it('reassembles a packet split at EVERY byte boundary (incl. mid-length-field)', () => {
    for (let split = 1; split < ex1.length; split++) {
      const framer = new StreamFramer()
      const first = framer.feed(ex1.subarray(0, split))
      const second = framer.feed(ex1.subarray(split))
      const frames = [...first, ...second]
      expect(frames, `split at ${split}`).toHaveLength(1)
      expect(frames[0]!.bytes.equals(ex1), `split at ${split}`).toBe(true)
    }
  })

  it('drip-fed one byte at a time still yields the exact packet', () => {
    const framer = new StreamFramer()
    const frames: ReturnType<StreamFramer['feed']> = []
    for (const byte of ex1) frames.push(...framer.feed(Buffer.from([byte])))
    expect(frames).toHaveLength(1)
    expect(frames[0]!.bytes.equals(ex1)).toBe(true)
  })

  it('two packets in one read → two frames', () => {
    const frames = new StreamFramer().feed(Buffer.concat([ex1, ex1]))
    expect(frames).toHaveLength(2)
    expect(frames[0]!.bytes.equals(ex1)).toBe(true)
    expect(frames[1]!.bytes.equals(ex1)).toBe(true)
  })

  it('IMEI handshake then AVL stream on the same connection', () => {
    const framer = new StreamFramer()
    const frames = framer.feed(Buffer.concat([imeiFrame, ex1]))
    expect(frames.map((f) => f.kind)).toEqual(['imei', 'avl'])
  })

  it('IMEI frame split across reads', () => {
    const framer = new StreamFramer()
    expect(framer.feed(imeiFrame.subarray(0, 1))).toHaveLength(0)
    expect(framer.feed(imeiFrame.subarray(1, 5))).toHaveLength(0)
    const frames = framer.feed(imeiFrame.subarray(5))
    expect(frames).toHaveLength(1)
    expect(frames[0]!.kind).toBe('imei')
  })

  it('declared data length > cap → FrameError (oversize attack, PROJECT_PLAN §3.3)', () => {
    const evil = Buffer.alloc(8)
    evil.writeUInt32BE(0, 0)
    evil.writeUInt32BE(5000, 4)
    expect(() => new StreamFramer().feed(evil)).toThrow(FrameError)
  })

  it('zero declared data length → FrameError', () => {
    const evil = Buffer.alloc(8)
    expect(() => new StreamFramer().feed(evil)).toThrow(FrameError)
  })

  it('absurd IMEI length prefix → FrameError', () => {
    // 4 bytes minimum before the framer classifies (needs the AVL-preamble check)
    const evil = Buffer.from([0xff, 0xff, 0x30, 0x30])
    expect(() => new StreamFramer().feed(evil)).toThrow(FrameError)
  })
})
