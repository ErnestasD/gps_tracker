import { FrameError } from './errors.js'

/**
 * Structural record-boundary scanner for Codec 8 / 8E AVL data
 * (https://wiki.teltonika-gps.com/view/Codec#Codec_8 / #Codec_8_Extended).
 * Returns the exact wire bytes of each record — the rec_hash input (invariant I3) —
 * and independently verifies the declared record count against the byte layout.
 *
 * Record layout: [8B timestamp][1B priority][15B GPS][IO element]
 * IO element Codec 8:  [1B event id][1B N][N1 cnt + (1B id, 1B val)…][N2…][N4…][N8…]
 * IO element Codec 8E: [2B event id][2B N][2B counts, 2B ids][extra NX group:
 *                      2B cnt + (2B id, 2B length, data)…]
 */
/**
 * The three widths a record is made of, stated separately because they do NOT move together.
 *
 * A single `extended: boolean` was enough while only Codec 8 and 8 Extended existed — one flips all
 * three at once. Codec 16 does not: its IO ids are TWO bytes like 8E, its counts are ONE byte like
 * 8, and it inserts a Generation Type byte that neither of the others has. Our own protocol research
 * flagged exactly this ("a naive {idSize, countSize} descriptor will conflate" — see
 * docs/protocols/teltonika-codec16.md §3.4), and the boolean would have produced a parser that
 * walks off the end of every Codec 16 record while looking correct on 8 and 8E.
 */
export interface RecordShape {
  /** width of an IO element's id */
  idSize: 1 | 2
  /** width of N-of-Total and of each per-group count */
  countSize: 1 | 2
  /** width of the Event IO ID field that opens the IO element */
  eventIdSize: 1 | 2
  /** Codec 16 only: one byte between the event id and N-of-Total (wiki /view/Codec) */
  generationType: boolean
  /** Codec 8E only: the NX variable-length group after N8 */
  nxGroup: boolean
}

export const SHAPE_8: RecordShape = { idSize: 1, countSize: 1, eventIdSize: 1, generationType: false, nxGroup: false }
export const SHAPE_8E: RecordShape = { idSize: 2, countSize: 2, eventIdSize: 2, generationType: false, nxGroup: true }
/** Codec 16: 2-byte ids, 1-byte counts, a generation-type byte, and NO NX group (verified absent). */
export const SHAPE_16: RecordShape = { idSize: 2, countSize: 1, eventIdSize: 2, generationType: true, nxGroup: false }

export function walkRecords(data: Buffer, shape: RecordShape): Buffer[] {
  const { idSize, countSize, eventIdSize } = shape
  const records: Buffer[] = []
  let off = 0

  const need = (n: number) => {
    if (off + n > data.length) {
      throw new FrameError(`record scan overrun at offset ${off} (+${n} of ${data.length})`, data)
    }
  }
  const readWidth = (w: 1 | 2): number => {
    need(w)
    const v = w === 2 ? data.readUInt16BE(off) : data[off]!
    off += w
    return v
  }
  const readCount = (): number => readWidth(countSize)

  while (off < data.length) {
    const start = off
    need(8 + 1 + 15)
    off += 8 + 1 + 15
    readWidth(eventIdSize) // event IO id — 1 B in Codec 8, 2 B in 8E and 16
    if (shape.generationType) {
      // Codec 16 only. NOT validated against the documented 0..7 enum on purpose: Go and Rust
      // implementations reject gen > 7 and abort the WHOLE packet, and our research says plainly
      // "Do not" (docs/protocols/teltonika-codec16.md §7 T-4). An unknown trigger reason is not a
      // reason to throw away positions we can otherwise decode byte-exactly.
      need(1)
      off += 1
    }
    const nTotal = readCount()
    let elements = 0
    for (const valueSize of [1, 2, 4, 8]) {
      const cnt = readCount()
      elements += cnt
      need(cnt * (idSize + valueSize))
      off += cnt * (idSize + valueSize)
    }
    if (shape.nxGroup) {
      // NX group: variable-length elements (BLE/EYE payloads)
      const cnt = readCount()
      elements += cnt
      for (let i = 0; i < cnt; i++) {
        need(2 + 2)
        const len = data.readUInt16BE(off + 2)
        off += 4
        need(len)
        off += len
      }
    }
    // N counts ALL elements incl. the 8E NX group — wiki 8E worked example (N=5, groups
    // 1+1+1+2+0) and cross-checked on 11 real Traccar records (N == fixed + NX in every one)
    if (elements !== nTotal) {
      throw new FrameError(`record N=${nTotal} but groups carry ${elements} elements`, data)
    }
    records.push(data.subarray(start, off))
  }
  return records
}

/**
 * Extract the Codec 8E NX-group (variable-length) elements of ONE record.
 * These carry BLE/EYE/ASCII payloads and are surfaced as raw Buffers —
 * the wrapped parser mangles them (returns NaN), so we are authoritative here.
 */
export function extractNx8e(record: Buffer): Map<number, Buffer> {
  let off = 24 + 2 // ts+prio+gps, 2B event id
  const total = record.readUInt16BE(off)
  void total
  off += 2
  for (const valueSize of [1, 2, 4, 8]) {
    const cnt = record.readUInt16BE(off)
    off += 2 + cnt * (2 + valueSize)
  }
  const out = new Map<number, Buffer>()
  const cnt = record.readUInt16BE(off)
  off += 2
  for (let i = 0; i < cnt; i++) {
    const id = record.readUInt16BE(off)
    const len = record.readUInt16BE(off + 2)
    off += 4
    out.set(id, Buffer.from(record.subarray(off, off + len)))
    off += len
  }
  return out
}

/**
 * The IO map of ONE Codec 16 record, read straight off the wire.
 *
 * Codec 8 and 8E go through the wrapped third-party parser (ADR-010); it does not know Codec 16, so
 * here we are the only reader. That is not a downgrade: the layout is fully verified — wiki
 * structure table, Traccar, a Go port and an Elixir port all agree, and it was re-decoded here
 * against every known frame (docs/protocols/teltonika-codec16.md §3.4).
 *
 * Values come back UNSIGNED, exactly as the wire carries them. Whether an id is signed is a property
 * of the AVL dictionary, not of the frame, and `applySign` is where that lives — the same seam Codec
 * 8 uses. Deciding it here would put protocol knowledge in two places.
 */
export function extractIo16(record: Buffer): Map<number, bigint> {
  const io = new Map<number, bigint>()
  let off = 24 + 2 + 1 // fixed head + 2 B event id + 1 B generation type
  if (off + 1 > record.length) throw new FrameError('codec 16 record too short for N of Total IO', record)
  const total = record[off]!
  off += 1
  for (const width of [1, 2, 4, 8] as const) {
    if (off + 1 > record.length) throw new FrameError(`codec 16 record ends before the N${width} count`, record)
    const count = record[off]!
    off += 1
    for (let i = 0; i < count; i++) {
      if (off + 2 + width > record.length) {
        throw new FrameError(`codec 16 record ends inside an N${width} element`, record)
      }
      const id = record.readUInt16BE(off)
      off += 2
      // via hex rather than readUIntBE: Node refuses widths above 6 bytes there, and an 8-byte AVL
      // value read as a JS number would lose precision above 2^53 — odometers live in that range
      io.set(id, BigInt(`0x${record.subarray(off, off + width).toString('hex')}`))
      off += width
    }
  }
  // the walker already proved the groups sum to N; asserting it again here would be theatre. What
  // this catches instead is a DUPLICATE id inside one record silently collapsing the map.
  if (io.size !== total) {
    throw new FrameError(`codec 16 record declares ${total} IO elements but yielded ${io.size} distinct ids`, record)
  }
  return io
}

/** The Generation Type byte (Codec 16 only) — the configured trigger of the IO that made the record. */
export function generationTypeOf(record: Buffer): number {
  if (record.length < 27) throw new FrameError('codec 16 record too short for a generation type', record)
  return record[26]!
}
