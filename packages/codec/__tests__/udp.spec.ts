import { describe, expect, it } from 'vitest'

import { encodeCodec12 } from '../src/codec12.js'
import { encodeAvlPacket } from '../src/encode.js'
import { FrameError } from '../src/errors.js'
import { decodeUdpHeader, decodeUdpPacket, encodeUdpAck, parseUdpAvl } from '../src/udp.js'

/**
 * Teltonika UDP Channel (connectionless) round-trip. The AVL payload is the same codec-8 data TCP
 * carries; UDP only differs in the wrapper (packet id + inline IMEI, no preamble/length/CRC).
 * Framing per Traccar TeltonikaProtocolDecoder.decodeUdp (Apache-2.0 oracle) — see src/udp.ts.
 */

/** Bare codec-8 AVL data = a full TCP frame minus the 8-byte preamble/length and 4-byte CRC. */
function avlData(records: Parameters<typeof encodeAvlPacket>[1]): Buffer {
  const frame = encodeAvlPacket(8, records)
  return frame.subarray(8, frame.length - 4)
}

/** Assemble a UDP datagram: [2B len][2B pktId][1B type][1B avlPktId][2B imeiLen][imei][avl data]. */
function udpDatagram(opts: { packetId?: number; avlPacketId?: number; imei?: string; avl: Buffer }): Buffer {
  const imei = Buffer.from(opts.imei ?? '356307042441013', 'ascii')
  const header = Buffer.alloc(8)
  header.writeUInt16BE(opts.packetId ?? 0x1234, 2)
  header.writeUInt8(0x01, 4) // packet type / not usable
  header.writeUInt8(opts.avlPacketId ?? 0x05, 5)
  header.writeUInt16BE(imei.length, 6)
  const afterLen = Buffer.concat([header.subarray(2), imei, opts.avl])
  const out = Buffer.concat([Buffer.alloc(2), afterLen])
  out.writeUInt16BE(afterLen.length, 0) // length counts every byte after itself
  return out
}

const rec = {
  tsMs: 1560161086000,
  priority: 1 as const,
  lat: 54.6872,
  lon: 25.2797,
  altitude: 100,
  angle: 90,
  satellites: 9,
  speed: 42,
  eventIoId: 0,
  io: new Map<number, bigint | Buffer>(),
}

describe('UDP Channel decode (Codec 8 over UDP)', () => {
  it('decodes packet id, AVL packet id, IMEI and the AVL records', () => {
    const dg = udpDatagram({ packetId: 0xabcd, avlPacketId: 0x07, imei: '356307042441013', avl: avlData([rec]) })
    const p = decodeUdpPacket(dg)
    expect(p.packetId).toBe(0xabcd)
    expect(p.avlPacketId).toBe(0x07)
    expect(p.imei).toBe('356307042441013')
    expect(p.parsed.kind).toBe('avl')
    if (p.parsed.kind !== 'avl') throw new Error('unreachable')
    expect(p.parsed.records).toHaveLength(1)
    expect(p.parsed.records[0]!.lat).toBeCloseTo(54.6872, 4)
    expect(p.parsed.records[0]!.speed).toBe(42)
  })

  it('decodes a multi-record datagram (same walker as TCP)', () => {
    const dg = udpDatagram({ avl: avlData([rec, { ...rec, speed: 60 }, { ...rec, speed: 0 }]) })
    const p = decodeUdpPacket(dg)
    if (p.parsed.kind !== 'avl') throw new Error('unreachable')
    expect(p.parsed.records.map((r) => r.speed)).toEqual([42, 60, 0])
  })

  it('rejects a datagram whose length field disagrees with the datagram size', () => {
    const dg = udpDatagram({ avl: avlData([rec]) })
    dg.writeUInt16BE(dg.readUInt16BE(0) + 1, 0) // corrupt the length field
    expect(() => decodeUdpPacket(dg)).toThrow(FrameError)
  })

  it('rejects a non-numeric / empty IMEI', () => {
    expect(() => decodeUdpPacket(udpDatagram({ imei: 'not-a-imei-xx', avl: avlData([rec]) }))).toThrow(FrameError)
  })

  it('rejects a datagram too short to hold a header', () => {
    expect(() => decodeUdpPacket(Buffer.from([0x00, 0x03, 0x00, 0x00, 0x00]))).toThrow(FrameError)
  })

  it('surfaces a structurally corrupt AVL body as a FrameError (record-count mismatch)', () => {
    const avl = avlData([rec])
    avl[1] = 5 // Number of Data 1 = 5 but body holds 1 → structural mismatch
    // wrapAsTcpFrame recomputes CRC over the tampered body, so parseFrame trips on n1!=n2 / walk
    expect(() => decodeUdpPacket(udpDatagram({ avl }))).toThrow(FrameError)
  })

  it('decodes an empty (zero-record) heartbeat datagram', () => {
    const dg = udpDatagram({ avl: avlData([]) })
    const p = decodeUdpPacket(dg)
    if (p.parsed.kind !== 'avl') throw new Error('unreachable')
    expect(p.parsed.records).toHaveLength(0)
  })

  it('decodeUdpHeader is cheap: returns ids + IMEI + unparsed AVL slice, no record walk', () => {
    const avl = avlData([rec])
    const h = decodeUdpHeader(udpDatagram({ packetId: 0x11, avlPacketId: 0x22, avl }))
    expect(h.packetId).toBe(0x11)
    expect(h.avlPacketId).toBe(0x22)
    expect(h.imei).toBe('356307042441013')
    expect(h.avlData.equals(avl)).toBe(true) // payload handed back verbatim for a later parse
  })

  it('parseUdpAvl decodes a command-codec (Codec 12) payload as a cmdResponse', () => {
    const frame = encodeCodec12('getver')
    const payload = frame.subarray(8, frame.length - 4) // strip preamble/length + CRC
    const parsed = parseUdpAvl(payload)
    expect(parsed.kind).toBe('cmdResponse')
  })
})

describe('UDP ACK encode', () => {
  it('echoes packet id + AVL packet id and the accepted count in the fixed 7-byte reply', () => {
    const ack = encodeUdpAck(0xabcd, 0x07, 3)
    expect(ack).toHaveLength(7)
    expect(ack.readUInt16BE(0)).toBe(5) // length of the 5 bytes that follow
    expect(ack.readUInt16BE(2)).toBe(0xabcd) // echoed packet id
    expect(ack.readUInt8(4)).toBe(0x01) // not-usable byte
    expect(ack.readUInt8(5)).toBe(0x07) // echoed AVL packet id
    expect(ack.readUInt8(6)).toBe(3) // accepted count
  })

  it('masks oversized ids/count into their byte widths', () => {
    const ack = encodeUdpAck(0x1_0000 + 0x42, 0x1_00 + 9, 0x1_00 + 1)
    expect(ack.readUInt16BE(2)).toBe(0x42)
    expect(ack.readUInt8(5)).toBe(9)
    expect(ack.readUInt8(6)).toBe(1)
  })
})
