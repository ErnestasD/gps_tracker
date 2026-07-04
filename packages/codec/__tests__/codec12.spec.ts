import { describe, expect, it } from 'vitest'

import codec12 from '../__fixtures__/wiki/codec12.hex.json' with { type: 'json' }
import { decodeCodec12, encodeCodec12 } from '../src/codec12.js'
import { FrameError } from '../src/errors.js'
import { StreamFramer } from '../src/frame.js'
import { hexBuf, type FixtureFile } from './helpers.js'

describe('Codec 12', () => {
  it('empty command → FrameError', () => {
    expect(() => encodeCodec12('')).toThrow(FrameError)
  })

  it('decodeCodec12 returns the response text for the wiki getio response', () => {
    const file = codec12 as FixtureFile
    const respCase = file.cases.find((c) => c.name === 'getio-response')!
    const frame = new StreamFramer().feed(hexBuf(respCase.hex))[0]!
    expect(decodeCodec12(frame)).toBe(respCase.expect!.text)
  })

  it('decodeCodec12 rejects a non-Codec-12 frame', () => {
    const imeiFrame = new StreamFramer().feed(hexBuf('000F333536333037303432343431303133'))[0]!
    expect(() => decodeCodec12(imeiFrame)).toThrow(FrameError)
  })

  it('own encode output re-frames and re-parses (request type 0x05)', () => {
    const pkt = encodeCodec12('setparam 2004:example.com')
    const frames = new StreamFramer().feed(pkt)
    expect(frames).toHaveLength(1)
    // request frames carry type 0x05 — our parse surfaces them as cmdResponse text too
    expect(frames[0]!.bytes[10]).toBe(0x05)
  })
})
