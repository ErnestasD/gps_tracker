import { crc16ibm } from '../src/crc16.js'

export interface FixtureCase {
  name: string
  direction: string
  hex: string
  note?: string
  encodeOf?: string
  expectError?: 'CrcError' | 'FrameError'
  expect?: {
    kind: 'imei' | 'avl' | 'cmdResponse'
    imei?: string
    codec?: number
    recordCount?: number
    rawFallback?: boolean
    text?: string
    nack?: boolean
    records?: Array<{
      tsMs?: number
      priority?: number
      lat?: number
      lon?: number
      altitude?: number
      angle?: number
      satellites?: number
      speed?: number
      eventIoId?: number
      io?: Record<string, string>
    }>
  }
}

export interface FixtureFile {
  source_url: string
  snapshot_url?: string
  license?: string
  retrieved_at: string
  attribution: string
  cases: FixtureCase[]
  encode?: Record<string, string>
}

export const hexBuf = (hex: string): Buffer => Buffer.from(hex, 'hex')

/**
 * Synthetic Codec 8 packet builder for edge-case tests only.
 * Layout per https://wiki.teltonika-gps.com/view/Codec#Codec_8 — the real encoder
 * for the simulator lands in E02-1 (ADR pending per E01-4 AC).
 */
export function buildCodec8Packet(records: Buffer[], opts?: { numberOfData2?: number }): Buffer {
  const data = Buffer.concat([
    Buffer.from([0x08, records.length]),
    ...records,
    Buffer.from([opts?.numberOfData2 ?? records.length]),
  ])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc16ibm(data))
  return Buffer.concat([Buffer.alloc(4), len, data, crc])
}

export function buildCodec8Record(opts: {
  tsMs?: number
  priority?: number
  lat?: number
  lon?: number
  altitude?: number
  angle?: number
  satellites?: number
  speed?: number
}): Buffer {
  const gps = Buffer.alloc(15)
  gps.writeInt32BE(Math.round((opts.lon ?? 0) * 1e7), 0)
  gps.writeInt32BE(Math.round((opts.lat ?? 0) * 1e7), 4)
  gps.writeInt16BE(opts.altitude ?? 0, 8)
  gps.writeUInt16BE(opts.angle ?? 0, 10)
  gps.writeUInt8(opts.satellites ?? 0, 12)
  gps.writeUInt16BE(opts.speed ?? 0, 13)
  const ts = Buffer.alloc(8)
  ts.writeBigUInt64BE(BigInt(opts.tsMs ?? 1560161086000))
  return Buffer.concat([
    ts,
    Buffer.from([opts.priority ?? 0]),
    gps,
    // minimal IO element: event id 0, N 0, all four group counts 0
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  ])
}
