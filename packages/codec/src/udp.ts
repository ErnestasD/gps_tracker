import { crc16ibm } from './crc16.js'
import { FrameError } from './errors.js'
import { parseFrame } from './parse.js'
import type { ParsedPacket } from './types.js'

/** The cheap-to-decode UDP header + the still-unparsed AVL payload slice. */
export interface UdpHeader {
  /** request packet id — echoed in the ACK so the device correlates the acknowledgement */
  packetId: number
  /** "AVL packet id" (a.k.a. location packet id) — also echoed in the ACK */
  avlPacketId: number
  imei: string
  /** the bare codec-8/8E payload; feed to parseUdpAvl AFTER authorizing the IMEI */
  avlData: Buffer
}

/** One fully decoded Teltonika UDP datagram. `packetId`/`avlPacketId` are echoed back in the ACK. */
export interface UdpPacket {
  packetId: number
  avlPacketId: number
  imei: string
  parsed: ParsedPacket
}

const MAX_IMEI_BYTES = 64 // generous vs the 15–17 digit real range, matches the TCP framer bound

/**
 * Decode ONLY the UDP header (§3.2 connectionless channel) — cheap: no AVL record walk / IO decode.
 * Splitting this from the body parse lets the listener authorize the IMEI (registry lookup) BEFORE
 * running the heavy parser, so an unauthenticated spoofed flood can't drive the expensive path
 * (ADR-027). Unlike TCP there is NO 0x00000000 preamble / 4-byte length / 4-byte CRC and NO separate
 * IMEI handshake — every datagram is self-contained.
 *
 * Layout (Traccar `TeltonikaProtocolDecoder.decodeUdp`, Apache-2.0 — CLAUDE.md "when stuck" oracle;
 * cross-references https://wiki.teltonika-gps.com/view/Codec "UDP Channel"):
 *   [2B length][2B packet id][1B unused][1B AVL packet id][2B IMEI length][IMEI ASCII][AVL data]
 * `length` counts every byte after itself.
 *
 * Throws FrameError on any structural problem — the caller drops the datagram (no ACK for a packet
 * whose header we could not even read).
 */
export function decodeUdpHeader(datagram: Buffer): UdpHeader {
  if (datagram.length < 8) throw new FrameError(`UDP datagram ${datagram.length} B too short for header`, datagram)
  const length = datagram.readUInt16BE(0)
  if (length !== datagram.length - 2) {
    throw new FrameError(`UDP length field ${length} != datagram remainder ${datagram.length - 2}`, datagram)
  }
  const packetId = datagram.readUInt16BE(2)
  // byte 4 = packet type ("not usable", constant 0x01) — skipped
  const avlPacketId = datagram.readUInt8(5)
  const imeiLen = datagram.readUInt16BE(6)
  const imeiEnd = 8 + imeiLen
  if (imeiLen === 0 || imeiLen > MAX_IMEI_BYTES || datagram.length < imeiEnd) {
    throw new FrameError(`UDP IMEI length ${imeiLen} invalid`, datagram)
  }
  const imei = datagram.subarray(8, imeiEnd).toString('ascii')
  if (!/^\d{8,17}$/.test(imei)) throw new FrameError(`UDP IMEI not numeric ASCII: ${imei.slice(0, 20)}`, datagram)
  return { packetId, avlPacketId, imei, avlData: datagram.subarray(imeiEnd) }
}

/**
 * Parse the AVL payload of a UDP datagram. The payload is the SAME codec-8/8E data TCP carries minus
 * the preamble/data-length/CRC, so we re-wrap it into a synthetic TCP frame (self-consistent CRC)
 * and decode through the single audited `parseFrame` path — one record walker / IO decoder for both
 * transports, no second implementation to drift.
 */
export function parseUdpAvl(avlData: Buffer): ParsedPacket {
  if (avlData.length < 3) throw new FrameError(`UDP AVL data ${avlData.length} B too short`, avlData)
  return parseFrame({ kind: 'avl', bytes: wrapAsTcpFrame(avlData) })
}

/** Convenience: decode header + parse body in one call (used by codec tests). */
export function decodeUdpPacket(datagram: Buffer): UdpPacket {
  const h = decodeUdpHeader(datagram)
  return { packetId: h.packetId, avlPacketId: h.avlPacketId, imei: h.imei, parsed: parseUdpAvl(h.avlData) }
}

/** Wrap a bare codec-8 payload in the TCP frame shape parseFrame expects (self-consistent CRC). */
function wrapAsTcpFrame(avlData: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(avlData.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc16ibm(avlData))
  return Buffer.concat([Buffer.alloc(4), len, avlData, crc])
}

/**
 * Build the UDP ACK datagram. Echoes the request's packet + AVL packet ids so the device can
 * correlate the acknowledgement, and reports the count of accepted records.
 *   [2B length=5][2B packet id][1B 0x01][1B AVL packet id][1B accepted count]
 * (Traccar writes length=5 then the two ids + count; we echo the request packet id rather than 0
 * so a device that validates the field stays in sync. Count is a single byte — n1 is capped at 255.)
 */
export function encodeUdpAck(packetId: number, avlPacketId: number, count: number): Buffer {
  const b = Buffer.alloc(7)
  b.writeUInt16BE(5, 0) // length of the 5 bytes that follow
  b.writeUInt16BE(packetId & 0xffff, 2) // echo request packet id
  b.writeUInt8(0x01, 4) // "not usable" byte, constant 0x01
  b.writeUInt8(avlPacketId & 0xff, 5) // echo AVL packet id
  b.writeUInt8(count & 0xff, 6) // accepted record count
  return b
}
