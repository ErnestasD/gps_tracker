import { describe, expect, it } from 'vitest'

import { crc16ibm } from '../src/crc16.js'
import { FrameError } from '../src/errors.js'
import { StreamFramer } from '../src/frame.js'
import { parseFrame } from '../src/parse.js'
import { buildCodec8Packet, buildCodec8Record } from './helpers.js'

const frameOf = (pkt: Buffer) => new StreamFramer().feed(pkt)[0]!

describe('protocol edge cases (synthetic mutations of wiki-spec packets)', () => {
  it('NumberOfData1 != NumberOfData2 → FrameError (wiki: counts must match)', () => {
    const pkt = buildCodec8Packet([buildCodec8Record({})], { numberOfData2: 2 })
    expect(() => parseFrame(frameOf(pkt))).toThrow(/NumberOfData mismatch/)
  })

  it('zero-record packet parses to empty records', () => {
    const pkt = buildCodec8Packet([])
    const parsed = parseFrame(frameOf(pkt))
    expect(parsed).toMatchObject({ kind: 'avl', codec: 8, records: [] })
  })

  it('southern/western hemisphere: two’s-complement coordinates exact to 1e-7 (wiki §GPS element)', () => {
    const pkt = buildCodec8Packet([
      buildCodec8Record({ lat: -54.1234567, lon: -25.7654321, altitude: -12, angle: 359, satellites: 9, speed: 77 }),
    ])
    const parsed = parseFrame(frameOf(pkt))
    if (parsed.kind !== 'avl') expect.unreachable()
    const rec = parsed.records[0]!
    expect(rec.lat).toBeCloseTo(-54.1234567, 7)
    expect(rec.lon).toBeCloseTo(-25.7654321, 7)
    expect(rec.altitude).toBe(-12)
    expect(rec.angle).toBe(359)
    expect(rec.satellites).toBe(9)
    expect(rec.speed).toBe(77)
  })

  it('priority=2 (PANIC) survives parse; priority>2 rejected', () => {
    const ok = parseFrame(frameOf(buildCodec8Packet([buildCodec8Record({ priority: 2 })])))
    if (ok.kind !== 'avl') expect.unreachable()
    expect(ok.records[0]!.priority).toBe(2)

    expect(() =>
      parseFrame(frameOf(buildCodec8Packet([buildCodec8Record({ priority: 5 })]))),
    ).toThrow(FrameError)
  })

  it('unknown codec id → FrameError', () => {
    const pkt = buildCodec8Packet([])
    pkt[8] = 0x99
    // fix CRC for the mutated span so we hit the codec-id check, not the CRC check
    const dataLen = pkt.readUInt32BE(4)
    pkt.writeUInt32BE(crc16ibm(pkt.subarray(8, 8 + dataLen)), 8 + dataLen)
    expect(() => parseFrame(frameOf(pkt))).toThrow(/unknown codec/)
  })

  it('timestamp at epoch extremes round-trips through parse', () => {
    const early = parseFrame(frameOf(buildCodec8Packet([buildCodec8Record({ tsMs: 0 })])))
    const late = parseFrame(
      frameOf(buildCodec8Packet([buildCodec8Record({ tsMs: 4102444800000 })])), // 2100-01-01
    )
    if (early.kind !== 'avl' || late.kind !== 'avl') expect.unreachable()
    expect(early.records[0]!.tsMs).toBe(0)
    expect(late.records[0]!.tsMs).toBe(4102444800000)
  })
})
