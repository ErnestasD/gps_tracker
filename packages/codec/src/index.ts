import { decodeCodec12, encodeCodec12 } from './codec12.js'
import { StreamFramer } from './frame.js'
import { parseFrame } from './parse.js'
import type { Frame, ParsedPacket, TeltonikaCodec } from './types.js'

export { crc16ibm } from './crc16.js'
export { CrcError, FrameError } from './errors.js'
export { StreamFramer } from './frame.js'
export { parseFrame } from './parse.js'
export { encodeCodec12, decodeCodec12 } from './codec12.js'
export { walkRecords, extractNx8e } from './walk.js'
export { encodeAvlPacket, type EncodableRecord } from './encode.js'
export { loadDictionary, type AvlDictionaryEntry, type DictionaryFamily } from './dictionaries.js'
export type { AvlRecord, Frame, ParsedPacket, TeltonikaCodec } from './types.js'

/** One instance per TCP connection (framer is stateful). Appendix A contract. */
export function createTeltonikaCodec(maxDataLength?: number): TeltonikaCodec {
  const framer = new StreamFramer(maxDataLength)
  return {
    feed: (chunk: Buffer): Frame[] => framer.feed(chunk),
    parse: (frame: Frame): ParsedPacket => parseFrame(frame),
    encodeAck(count: number): Buffer {
      const b = Buffer.alloc(4)
      b.writeUInt32BE(count)
      return b
    },
    encodeImeiReply: (accept: boolean): Buffer => Buffer.from([accept ? 0x01 : 0x00]),
    encodeCodec12,
    decodeCodec12,
  }
}
