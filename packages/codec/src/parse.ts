import { ProtocolParser } from 'complete-teltonika-parser'

import { crc16ibm } from './crc16.js'
import { CrcError, FrameError } from './errors.js'
import { extractNx8e, walkRecords } from './walk.js'
import type { AvlRecord, Frame, ParsedPacket } from './types.js'

/**
 * Parse one complete frame (from StreamFramer).
 * Structure + CRC are verified in-house (wiki spec, PROJECT_PLAN §3.3); field decode of
 * IO elements is delegated to complete-teltonika-parser (ADR-010) and cross-checked
 * against our own record-boundary walk.
 */
export function parseFrame(frame: Frame): ParsedPacket {
  if (frame.kind === 'imei') {
    const imei = frame.bytes.subarray(2).toString('ascii')
    if (!/^\d{8,17}$/.test(imei)) {
      throw new FrameError(`IMEI payload is not numeric ASCII: ${imei.slice(0, 20)}`, frame.bytes)
    }
    return { kind: 'imei', imei }
  }

  const bytes = frame.bytes
  const dataLen = bytes.readUInt32BE(4)
  if (bytes.length !== 8 + dataLen + 4) {
    throw new FrameError(`frame length ${bytes.length} != declared ${8 + dataLen + 4}`, bytes)
  }
  // CRC-16/IBM over Codec ID .. Number of Data 2 (wiki: Codec page, packet structure)
  const span = bytes.subarray(8, 8 + dataLen)
  const crcExpected = bytes.readUInt32BE(8 + dataLen)
  const crcActual = crc16ibm(span)
  if (crcActual !== crcExpected) {
    throw new CrcError(`CRC mismatch: computed ${crcActual}, packet says ${crcExpected}`, bytes)
  }

  const codecId = bytes[8]!
  switch (codecId) {
    case 0x08:
    case 0x8e:
      return parseAvl(bytes, dataLen, codecId)
    case 0x10:
      // v1 contract: Codec 16 = raw fallback after CRC/framing verify (PROJECT_PLAN §3.1)
      return { kind: 'avl', codec: 16, records: [], rawFallback: true }
    case 0x0c:
    case 0x0d:
    case 0x0e:
      return parseCommandFrame(bytes, dataLen, codecId)
    default:
      throw new FrameError(`unknown codec id 0x${codecId.toString(16)}`, bytes)
  }
}

function parseAvl(bytes: Buffer, dataLen: number, codecId: 0x08 | 0x8e): ParsedPacket {
  const n1 = bytes[9]!
  const n2 = bytes[8 + dataLen - 1]!
  if (n1 !== n2) {
    throw new FrameError(`NumberOfData mismatch: ${n1} != ${n2}`, bytes)
  }
  const codec = codecId === 0x08 ? 8 : 0x8e
  if (n1 === 0) return { kind: 'avl', codec, records: [] }

  const recordsRegion = bytes.subarray(10, 8 + dataLen - 1)
  const rawSlices = walkRecords(recordsRegion, codecId === 0x8e)
  if (rawSlices.length !== n1) {
    throw new FrameError(`walked ${rawSlices.length} records, header says ${n1}`, bytes)
  }

  const ioPerRecord = decodeIoWithLib(bytes, n1)

  const records: AvlRecord[] = rawSlices.map((raw, i) => {
    const tsMs = Number(raw.readBigUInt64BE(0))
    const priority = raw[8]!
    if (priority > 2) throw new FrameError(`priority ${priority} outside 0..2`, bytes)
    const idSize = codecId === 0x8e ? 2 : 1
    const io = ioPerRecord[i]!
    if (codecId === 0x8e) {
      // NX-group elements: our raw extraction is authoritative (lib returns NaN for these)
      for (const [id, buf] of extractNx8e(raw)) io.set(id, buf)
    }
    for (const [id, v] of io) {
      if (v === null) throw new FrameError(`undecodable IO value for AVL id ${id}`, bytes)
    }
    return {
      tsMs,
      priority: priority as 0 | 1 | 2,
      // GPS element (wiki §Codec 8): lon/lat int32 two's complement of deg×1e7
      lon: raw.readInt32BE(9) / 1e7,
      lat: raw.readInt32BE(13) / 1e7,
      altitude: raw.readInt16BE(17),
      angle: raw.readUInt16BE(19),
      satellites: raw[21]!,
      speed: raw.readUInt16BE(22),
      eventIoId: idSize === 2 ? raw.readUInt16BE(24) : raw[24]!,
      io: io as Map<number, bigint | Buffer>,
      raw: Buffer.from(raw), // detached copy: framer buffers get reused
    }
  })
  return { kind: 'avl', codec, records }
}

/** Minimal shape we rely on from the wrapped parser — never re-exported (ADR-010). */
interface LibAvlData {
  IOelement?: { Elements?: Record<string, unknown> }
}

/**
 * Field decode via the wrapped parser (ADR-010); values normalized to bigint|Buffer.
 * `null` marks values the lib could not decode (NaN) — 8E NX extraction overrides them,
 * and any survivor null fails the parse loudly (never silently dropped).
 */
function decodeIoWithLib(
  bytes: Buffer,
  expectedCount: number,
): Map<number, bigint | Buffer | null>[] {
  let parsed: InstanceType<typeof ProtocolParser>
  try {
    parsed = new ProtocolParser(bytes.toString('hex'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/crc/i.test(msg)) throw new CrcError(msg, bytes)
    throw new FrameError(`wrapped parser rejected packet: ${msg}`, bytes)
  }
  const content = parsed.Content as { AVL_Datas?: unknown } | undefined
  const rawDatas = content?.AVL_Datas
  if (!Array.isArray(rawDatas) || rawDatas.length !== expectedCount) {
    throw new FrameError(
      `wrapped parser saw ${Array.isArray(rawDatas) ? rawDatas.length : 0} records, expected ${expectedCount}`,
      bytes,
    )
  }
  return (rawDatas as LibAvlData[]).map((d) => {
    const io = new Map<number, bigint | Buffer | null>()
    const elements = d.IOelement?.Elements ?? {}
    for (const [id, value] of Object.entries(elements)) {
      io.set(Number(id), normalizeIoValue(value))
    }
    return io
  })
}

/** Exported for direct unit-testing of all normalization branches. */
export function normalizeIoValue(value: unknown): bigint | Buffer | null {
  switch (typeof value) {
    case 'bigint':
      return value
    case 'number':
      return Number.isSafeInteger(value) ? BigInt(value) : null
    case 'boolean':
      return value ? 1n : 0n
    case 'string':
      if (/^-?\d+$/.test(value)) return BigInt(value)
      if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value)
      return Buffer.from(value, 'latin1')
    default:
      if (Buffer.isBuffer(value)) return value
      throw new FrameError(`unsupported IO value type ${typeof value}`)
  }
}

function parseCommandFrame(bytes: Buffer, dataLen: number, codecId: number): ParsedPacket {
  // Codec 12/13/14 layout (wiki §Codec_12..14):
  // [1B codec][1B quantity][1B type 0x05|0x06|0x11][4B size][payload][1B quantity2][4B CRC]
  const type = bytes[10]!
  const size = bytes.readUInt32BE(11)
  const payloadEnd = 15 + size
  if (payloadEnd + 1 !== 8 + dataLen) {
    throw new FrameError(`command payload size ${size} inconsistent with data length`, bytes)
  }
  const payload = bytes.subarray(15, payloadEnd)
  const codec = codecId === 0x0c ? 12 : codecId === 0x0d ? 13 : 14
  if (codec === 14 && type === 0x11) {
    return { kind: 'cmdResponse', codec, text: '', nack: true }
  }
  if (type !== 0x05 && type !== 0x06) {
    throw new FrameError(`unknown command frame type 0x${type.toString(16)}`, bytes)
  }
  // Codec 13 payload starts with 4B timestamp; Codec 14 with 8B IMEI (wiki examples)
  const textStart = codec === 13 ? 4 : codec === 14 ? 8 : 0
  return { kind: 'cmdResponse', codec, text: payload.subarray(textStart).toString('latin1') }
}
