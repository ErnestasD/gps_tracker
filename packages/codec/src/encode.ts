import { crc16ibm } from './crc16.js'
import { FrameError } from './errors.js'

/**
 * Codec 8 / 8E packet encoder (https://wiki.teltonika-gps.com/view/Codec).
 * Primary consumers: the property test (parse(encode(x)) ≡ x) and tools/simulator
 * (E02-1, ADR-012). Byte layout mirrors walk.ts — the two verify each other.
 */
export interface EncodableRecord {
  tsMs: number
  priority: 0 | 1 | 2
  lat: number
  lon: number
  altitude: number
  angle: number
  satellites: number
  speed: number
  eventIoId: number
  /** bigint → fixed-size group by magnitude (1/2/4/8 B); Buffer → 8E NX group only. */
  io: Map<number, bigint | Buffer>
}

export function encodeAvlPacket(codec: 8 | 0x8e, records: EncodableRecord[]): Buffer {
  if (records.length > 0xff) {
    throw new FrameError(`NumberOfData is one byte — cannot encode ${records.length} records`)
  }
  const extended = codec === 0x8e
  const body = Buffer.concat(records.map((r) => encodeRecord(r, extended)))
  const data = Buffer.concat([
    Buffer.from([codec, records.length]),
    body,
    Buffer.from([records.length]),
  ])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc16ibm(data))
  return Buffer.concat([Buffer.alloc(4), len, data, crc])
}

function encodeRecord(r: EncodableRecord, extended: boolean): Buffer {
  const head = Buffer.alloc(24)
  head.writeBigUInt64BE(BigInt(r.tsMs), 0)
  head.writeUInt8(r.priority, 8)
  head.writeInt32BE(Math.round(r.lon * 1e7), 9)
  head.writeInt32BE(Math.round(r.lat * 1e7), 13)
  head.writeInt16BE(r.altitude, 17)
  head.writeUInt16BE(r.angle, 19)
  head.writeUInt8(r.satellites, 21)
  head.writeUInt16BE(r.speed, 22)

  const idSize = extended ? 2 : 1
  const groups: Record<1 | 2 | 4 | 8, Array<[number, bigint]>> = { 1: [], 2: [], 4: [], 8: [] }
  const nx: Array<[number, Buffer]> = []
  for (const [id, value] of r.io) {
    if (!extended && id > 0xff) throw new FrameError(`Codec 8 cannot carry AVL id ${id} > 255`)
    if (Buffer.isBuffer(value)) {
      if (!extended) throw new FrameError('variable-length IO values need Codec 8E (NX group)')
      nx.push([id, value])
    } else {
      groups[valueSize(value)].push([id, value])
    }
  }

  const parts: Buffer[] = [head, writeId(r.eventIoId, idSize)]
  // N counts ALL elements incl. NX (wiki 8E example + 11 real Traccar records agree)
  const totalCount =
    groups[1].length + groups[2].length + groups[4].length + groups[8].length + nx.length
  parts.push(writeId(totalCount, idSize))
  for (const size of [1, 2, 4, 8] as const) {
    parts.push(writeId(groups[size].length, idSize))
    for (const [id, value] of groups[size]) {
      const v = Buffer.alloc(size)
      if (size === 8) v.writeBigUInt64BE(value, 0)
      else v.writeUIntBE(Number(value), 0, size)
      parts.push(writeId(id, idSize), v)
    }
  }
  if (extended) {
    const cnt = Buffer.alloc(2)
    cnt.writeUInt16BE(nx.length)
    parts.push(cnt)
    for (const [id, buf] of nx) {
      if (buf.length > 0xffff) {
        throw new FrameError(`NX element ${id} payload ${buf.length} B exceeds 2-byte length field`)
      }
      const hdr = Buffer.alloc(4)
      hdr.writeUInt16BE(id, 0)
      hdr.writeUInt16BE(buf.length, 2)
      parts.push(hdr, buf)
    }
  }
  return Buffer.concat(parts)
}

function valueSize(v: bigint): 1 | 2 | 4 | 8 {
  if (v < 0n) throw new FrameError('negative IO values are not encodable (unsigned wire format)')
  if (v <= 0xffn) return 1
  if (v <= 0xffffn) return 2
  if (v <= 0xffffffffn) return 4
  if (v <= 0xffffffffffffffffn) return 8
  throw new FrameError(`IO value ${v} exceeds 8 bytes`)
}

function writeId(id: number, idSize: 1 | 2): Buffer {
  const b = Buffer.alloc(idSize)
  if (idSize === 2) b.writeUInt16BE(id)
  else b.writeUInt8(id)
  return b
}
