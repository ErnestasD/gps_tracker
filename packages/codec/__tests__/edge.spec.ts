import { describe, expect, it } from 'vitest'

import { crc16ibm } from '../src/crc16.js'
import { encodeAvlPacket } from '../src/encode.js'
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

  it('priority=2 (PANIC) survives parse; priority>2 is ISOLATED, not thrown', () => {
    const ok = parseFrame(frameOf(buildCodec8Packet([buildCodec8Record({ priority: 2 })])))
    if (ok.kind !== 'avl') expect.unreachable()
    expect(ok.records[0]!.priority).toBe(2)

    // CHANGED DELIBERATELY. This used to assert a throw, i.e. that one unexpected byte discards the
    // whole packet. Traccar stores priority unvalidated and the wiki defines only 0/1/2, so an
    // unexpected value is a firmware quirk — and throwing made it a livelock: the device resends
    // the identical bytes forever and its own buffer overwrites its oldest records. The record is
    // now isolated with a reason, so the caller can park it and ACK what the device sent.
    const bad = parseFrame(frameOf(buildCodec8Packet([buildCodec8Record({ priority: 5 })])))
    if (bad.kind !== 'avl') expect.unreachable()
    expect(bad.records).toHaveLength(0)
    expect(bad.badRecords?.[0]?.reason).toMatch(/priority 5/)
    expect(bad.declaredCount).toBe(1) // …and the device still gets its count back
  })

  it('ONE bad record does not discard the good ones in the same packet', () => {
    /**
     * TEST FIRST — this is the behaviour, not the implementation.
     *
     * `parseAvl` throws out of a `.map()`, so a single unexpected byte in the LAST record discards
     * every record before it. On its own that is not loss: the count mismatch makes the device
     * resend the whole packet. It becomes permanent loss the moment the failure is DETERMINISTIC —
     * a repeated AVL id, which our walker accepts and the wrapped parser refuses — because the
     * resend fails identically forever, the device's ACK cursor never moves, and its own buffer
     * eventually overwrites its OLDEST records. Two good fixes queued behind one poison record are
     * gone, and nothing anywhere says so.
     *
     * The packet must therefore survive with the good records intact and the bad one identified,
     * so the caller can persist what it can and park the rest — the same shape codec 16 already
     * uses, and the one the protocol actually honours.
     */
    const good = buildCodec8Record({ priority: 0, satellites: 7 })
    const bad = buildCodec8Record({ priority: 5 }) // outside 0..2
    const parsed = parseFrame(frameOf(buildCodec8Packet([good, good, bad])))
    if (parsed.kind !== 'avl') expect.unreachable()

    expect(parsed.records).toHaveLength(2) // the two good ones survived
    expect(parsed.records.every((r) => r.satellites === 7)).toBe(true)
    // …and the packet still declares three, so the caller can ACK what the device sent rather than
    // under-ACKing and inviting the very resend this avoids
    expect(parsed.declaredCount).toBe(3)
    expect(parsed.badRecords).toHaveLength(1)
    expect(parsed.badRecords?.[0]?.reason).toMatch(/priority 5/)
  })

  it('record N disagreeing with group counts → FrameError (walker cross-check)', () => {
    const pkt = buildCodec8Packet([buildCodec8Record({})])
    pkt[35] = 3 // N byte of the (element-less) record: claim 3 elements
    const dataLen = pkt.readUInt32BE(4)
    pkt.writeUInt32BE(crc16ibm(pkt.subarray(8, 8 + dataLen)), 8 + dataLen)
    expect(() => parseFrame(frameOf(pkt))).toThrow(/groups carry/)
  })

  it('encoder refuses >255 records (1-byte NumberOfData) and oversize NX payloads', () => {
    const rec = {
      tsMs: 1700000000000,
      priority: 0 as const,
      lat: 0,
      lon: 0,
      altitude: 0,
      angle: 0,
      satellites: 0,
      speed: 0,
      eventIoId: 0,
      io: new Map<number, bigint | Buffer>(),
    }
    expect(() => encodeAvlPacket(8, Array.from({ length: 256 }, () => rec))).toThrow(/one byte/)
    const big = { ...rec, io: new Map<number, bigint | Buffer>([[10, Buffer.alloc(0x10000)]]) }
    expect(() => encodeAvlPacket(0x8e, [big])).toThrow(/exceeds 2-byte/)
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

  it('a TRUNCATED command frame is a FrameError, never a RangeError that kills the socket', () => {
    // REGRESSION (audit MED): parseCommandFrame read bytes[10] and readUInt32BE(11) with no bounds
    // check. The framer accepts dataLen down to 1, and the only prior length check is
    // `length === 8 + dataLen + 4` — so a 13-byte frame whose single data byte is 0x0C, with a
    // MATCHING CRC, sailed through the CRC gate and threw a RangeError. That is not a FrameError,
    // so the ingest session's catch missed it: the socket was destroyed with NO ACK, breaking
    // rule 4 / §3.2 (ACK the count actually persisted), and neither parse-fail counter moved.
    for (const body of [Buffer.from([0x0c]), Buffer.from([0x0d, 0x01]), Buffer.from([0x0e, 0x01, 0x05, 0x00, 0x00])]) {
      const pkt = Buffer.alloc(8 + body.length + 4)
      pkt.writeUInt32BE(body.length, 4)
      body.copy(pkt, 8)
      pkt.writeUInt32BE(crc16ibm(body), 8 + body.length)
      expect(() => parseFrame(frameOf(pkt)), body.toString('hex')).toThrow(FrameError)
    }
  })

  it('a command payload shorter than its own mandatory prefix is a FrameError, not an empty response', () => {
    // codec 13 carries a 4B timestamp before the text, codec 14 an 8B IMEI. A `size` smaller than
    // that is malformed — without the check `payload.subarray(textStart)` clamps to '' and we hand
    // the caller a silently EMPTY command result instead of saying the frame is broken.
    for (const [codecId, size] of [[0x0e, 2], [0x0d, 1]] as const) {
      const body = Buffer.concat([
        Buffer.from([codecId, 0x01, 0x05]),
        (() => { const b = Buffer.alloc(4); b.writeUInt32BE(size); return b })(),
        Buffer.alloc(size),
        Buffer.from([0x01]),
      ])
      const pkt = Buffer.alloc(8 + body.length + 4)
      pkt.writeUInt32BE(body.length, 4)
      body.copy(pkt, 8)
      pkt.writeUInt32BE(crc16ibm(body), 8 + body.length)
      expect(() => parseFrame(frameOf(pkt)), `codec ${codecId} size ${size}`).toThrow(/shorter than its/)
    }
  })
})
