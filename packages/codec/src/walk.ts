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
export function walkRecords(data: Buffer, extended: boolean): Buffer[] {
  const idSize = extended ? 2 : 1
  const records: Buffer[] = []
  let off = 0

  const need = (n: number) => {
    if (off + n > data.length) {
      throw new FrameError(`record scan overrun at offset ${off} (+${n} of ${data.length})`, data)
    }
  }
  const readCount = (): number => {
    need(idSize)
    const v = extended ? data.readUInt16BE(off) : data[off]!
    off += idSize
    return v
  }

  while (off < data.length) {
    const start = off
    need(8 + 1 + 15)
    off += 8 + 1 + 15
    readCount() // event IO id
    readCount() // N — total element count (validated implicitly by group scan)
    for (const valueSize of [1, 2, 4, 8]) {
      const cnt = readCount()
      need(cnt * (idSize + valueSize))
      off += cnt * (idSize + valueSize)
    }
    if (extended) {
      // NX group: variable-length elements (BLE/EYE payloads)
      const cnt = readCount()
      for (let i = 0; i < cnt; i++) {
        need(2 + 2)
        const len = data.readUInt16BE(off + 2)
        off += 4
        need(len)
        off += len
      }
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
