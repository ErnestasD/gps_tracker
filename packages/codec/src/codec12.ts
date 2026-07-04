import { crc16ibm } from './crc16.js'
import { FrameError } from './errors.js'
import { parseFrame } from './parse.js'
import type { Frame } from './types.js'

/**
 * Codec 12 command encoding (https://wiki.teltonika-gps.com/view/Codec#Codec_12):
 * [4B preamble 0][4B data length][0x0C][0x01 quantity][0x05 type=command]
 * [4B command size][ASCII command][0x01 quantity2][4B CRC-16 of codec..quantity2]
 */
export function encodeCodec12(cmd: string): Buffer {
  if (cmd.length === 0) throw new FrameError('empty Codec 12 command')
  const ascii = Buffer.from(cmd, 'ascii')
  const data = Buffer.concat([
    Buffer.from([0x0c, 0x01, 0x05]),
    u32(ascii.length),
    ascii,
    Buffer.from([0x01]),
  ])
  return Buffer.concat([Buffer.alloc(4), u32(data.length), data, u32(crc16ibm(data))])
}

export function decodeCodec12(frame: Frame): string {
  const parsed = parseFrame(frame)
  if (parsed.kind !== 'cmdResponse' || parsed.codec !== 12) {
    throw new FrameError(`expected a Codec 12 response frame, got ${parsed.kind}`, frame.bytes)
  }
  return parsed.text
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
