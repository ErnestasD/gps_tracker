import { describe, expect, it } from 'vitest'

import { crc16ibm } from '../src/crc16.js'
import { encodeAvlPacket } from '../src/encode.js'
import { encodeCodec12 } from '../src/codec12.js'
import { FrameError } from '../src/errors.js'
import { StreamFramer } from '../src/frame.js'
import { createTeltonikaCodec } from '../src/index.js'
import { normalizeIoValue, parseFrame } from '../src/parse.js'
import { walkRecords } from '../src/walk.js'
import { buildCodec8Packet, buildCodec8Record } from './helpers.js'

const reCrc = (pkt: Buffer): Buffer => {
  const dataLen = pkt.readUInt32BE(4)
  pkt.writeUInt32BE(crc16ibm(pkt.subarray(8, 8 + dataLen)), 8 + dataLen)
  return pkt
}

describe('error paths & wrapper internals', () => {
  it('frame bytes shorter than declared → FrameError (parse-level check)', () => {
    const pkt = buildCodec8Packet([buildCodec8Record({})])
    expect(() => parseFrame({ kind: 'avl', bytes: pkt.subarray(0, pkt.length - 1) })).toThrow(
      /declared/,
    )
  })

  it('non-numeric IMEI payload → FrameError', () => {
    const bytes = Buffer.concat([Buffer.from([0x00, 0x05]), Buffer.from('abcde', 'ascii')])
    expect(() => parseFrame({ kind: 'imei', bytes })).toThrow(FrameError)
  })

  it('walker overrun on truncated record region → FrameError', () => {
    expect(() => walkRecords(Buffer.alloc(10), false)).toThrow(/overrun/)
  })

  it('command frame with unknown type byte → FrameError', () => {
    const pkt = Buffer.from(encodeCodec12('getinfo'))
    pkt[10] = 0x07
    expect(() => parseFrame({ kind: 'avl', bytes: reCrc(pkt) })).toThrow(/unknown command frame type/)
  })

  it('command frame with inconsistent payload size → FrameError', () => {
    const pkt = Buffer.from(encodeCodec12('getinfo'))
    pkt.writeUInt32BE(3, 11) // lie about size
    expect(() => parseFrame({ kind: 'avl', bytes: reCrc(pkt) })).toThrow(/inconsistent/)
  })

  it('own Codec 12 request (type 0x05) parses as cmdResponse text', () => {
    const frame = new StreamFramer().feed(encodeCodec12('getver'))[0]!
    expect(parseFrame(frame)).toMatchObject({ kind: 'cmdResponse', codec: 12, text: 'getver' })
  })

  it('normalizeIoValue covers every branch', () => {
    expect(normalizeIoValue(7n)).toBe(7n)
    expect(normalizeIoValue(7)).toBe(7n)
    expect(normalizeIoValue(Number.NaN)).toBeNull()
    expect(normalizeIoValue(true)).toBe(1n)
    expect(normalizeIoValue(false)).toBe(0n)
    expect(normalizeIoValue('123')).toBe(123n)
    expect(normalizeIoValue('0xff')).toBe(255n)
    const buf = normalizeIoValue('AB') as Buffer
    expect(Buffer.isBuffer(buf) && buf.toString('latin1') === 'AB').toBe(true)
    const passthrough = normalizeIoValue(Buffer.from([1, 2]))
    expect(Buffer.isBuffer(passthrough)).toBe(true)
    expect(() => normalizeIoValue({})).toThrow(FrameError)
    expect(() => normalizeIoValue(undefined)).toThrow(FrameError)
  })

  it('encoder guards: codec8 id>255, Buffer in codec8, negative & oversize values', () => {
    const rec = buildRecordWithIo(new Map([[300, 1n]]))
    expect(() => encodeAvlPacket(8, [rec])).toThrow(/255/)
    expect(() => encodeAvlPacket(8, [buildRecordWithIo(new Map([[10, Buffer.from('x')]]))])).toThrow(
      /8E/,
    )
    expect(() => encodeAvlPacket(8, [buildRecordWithIo(new Map([[10, -1n]]))])).toThrow(/negative/)
    expect(() => encodeAvlPacket(8, [buildRecordWithIo(new Map([[10, 1n << 64n]]))])).toThrow(
      /exceeds/,
    )
  })

  it('TeltonikaCodec facade wires feed/parse/decodeCodec12 end-to-end', () => {
    const codec = createTeltonikaCodec()
    const frames = codec.feed(buildCodec8Packet([buildCodec8Record({ satellites: 5 })]))
    expect(frames).toHaveLength(1)
    const parsed = codec.parse(frames[0]!)
    if (parsed.kind !== 'avl') expect.unreachable()
    expect(parsed.records[0]!.satellites).toBe(5)
    expect(() => codec.decodeCodec12(frames[0]!)).toThrow(FrameError)
  })
})

function buildRecordWithIo(io: Map<number, bigint | Buffer>) {
  return {
    tsMs: 1700000000000,
    priority: 0 as const,
    lat: 0,
    lon: 0,
    altitude: 0,
    angle: 0,
    satellites: 0,
    speed: 0,
    eventIoId: 0,
    io,
  }
}
