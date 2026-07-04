import { FrameError } from './errors.js'
import type { Frame } from './types.js'

/**
 * Streaming framer, one instance per TCP connection.
 * Wire format (https://wiki.teltonika-gps.com/view/Codec):
 *  - IMEI handshake frame: [2B length][ASCII IMEI] — length is non-zero (0x000F for 15 digits)
 *  - AVL/command frame:    [4B preamble = 0x00000000][4B data length][data][4B CRC]
 * The two are distinguishable by the first 4 bytes: only AVL frames start with zeros.
 * Max declared data length is capped (default 4096; protocol max packet is 1280 B,
 * PROJECT_PLAN §3.3) — anything larger is a protocol violation.
 */
export class StreamFramer {
  private buf: Buffer = Buffer.alloc(0)

  constructor(private readonly maxDataLength = 4096) {}

  feed(chunk: Buffer): Frame[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    const frames: Frame[] = []
    for (;;) {
      const frame = this.tryExtract()
      if (!frame) break
      frames.push(frame)
    }
    return frames
  }

  private tryExtract(): Frame | null {
    const buf = this.buf
    if (buf.length < 4) return null

    if (buf.readUInt32BE(0) !== 0) {
      // IMEI handshake frame: 2B length prefix
      const len = buf.readUInt16BE(0)
      if (len === 0 || len > 64) {
        throw new FrameError(`invalid IMEI length prefix ${len}`, buf.subarray(0, 4))
      }
      if (buf.length < 2 + len) return null
      const bytes = buf.subarray(0, 2 + len)
      this.buf = buf.subarray(2 + len)
      return { kind: 'imei', bytes }
    }

    // AVL frame: preamble zeros, then 4B data field length
    if (buf.length < 8) return null
    const dataLen = buf.readUInt32BE(4)
    if (dataLen === 0 || dataLen > this.maxDataLength) {
      throw new FrameError(`declared data length ${dataLen} outside 1..${this.maxDataLength}`, buf.subarray(0, 8))
    }
    const total = 8 + dataLen + 4
    if (buf.length < total) return null
    const bytes = buf.subarray(0, total)
    this.buf = buf.subarray(total)
    return { kind: 'avl', bytes }
  }
}
