import { describe, expect, it } from 'vitest'

import { UndecodableRecordsError, CrcError, FrameError } from '../src/errors.js'
import { StreamFramer } from '../src/frame.js'
import { parseFrame } from '../src/parse.js'

import { buildCodec8Packet, buildCodec8Record } from './helpers.js'

/**
 * A frame whose STRUCTURE is sound but whose records our decoder cannot read.
 *
 * The distinction decides the ACK, and getting it wrong costs a customer their history. A CRC or
 * framing fault is transient — retransmission genuinely fixes it, so ACK 0 is right. A frame whose
 * CONTENT defeats the decoder is a property of the bytes: the device re-sends the identical packet
 * forever, its ACK cursor never advances, and its own buffer eventually overwrites its OLDEST unsent
 * records. Reproduced live against staging ingest before this change: the same frame answered
 * `00000000` on every attempt, and the perfectly valid record sharing that frame died with it.
 *
 * The trigger reachable from real hardware is a repeated AVL IO id inside one record — our own
 * walker accepts it and the wrapped parser refuses it.
 */

/** A codec-8 record whose IO element declares the SAME 1-byte id twice. */
function recordWithRepeatedIoId(): Buffer {
  const base = buildCodec8Record({ lat: 54.6872, lon: 25.2797, satellites: 9 })
  const head = base.subarray(0, base.length - 6) // drop the empty IO element
  return Buffer.concat([
    head,
    Buffer.from([
      0x01, // event io id
      0x02, // total elements
      0x02, // 1-byte group count = 2
      0x01, 0x05, // id 1 = 5
      0x01, 0x07, // id 1 AGAIN = 7   ← the poison
      0x00, 0x00, 0x00, // 2/4/8-byte groups empty
    ]),
  ])
}

describe('a structurally sound frame we cannot decode', () => {
  it('is UndecodableRecordsError, and carries the count the device declared', () => {
    const good = buildCodec8Record({ lat: 54.7, lon: 25.3, satellites: 8 })
    const packet = buildCodec8Packet([good, recordWithRepeatedIoId()])
    let thrown: unknown
    try {
      parseFrame(new StreamFramer().feed(packet)[0]!)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(UndecodableRecordsError)
    expect(thrown).toBeInstanceOf(FrameError) // …still a FrameError, so old handlers still catch it
    expect((thrown as UndecodableRecordsError).declaredCount).toBe(2)
    expect((thrown as Error).message).toMatch(/repeated id/i)
  })

  it('a CRC fault is NOT this — retransmission fixes it, so it must keep ACKing 0', () => {
    const packet = buildCodec8Packet([buildCodec8Record({ satellites: 5 })])
    packet[packet.length - 1] = (packet[packet.length - 1]! ^ 0xff) & 0xff
    let thrown: unknown
    try {
      parseFrame(new StreamFramer().feed(packet)[0]!)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CrcError)
    expect(thrown).not.toBeInstanceOf(UndecodableRecordsError)
  })

  it('a NumberOfData mismatch is NOT this either — the structure itself is wrong', () => {
    // The declared count is what gets ACKed, so it must never be trusted from a frame whose two
    // NumberOfData bytes disagree. That check runs BEFORE the decoder, which is exactly why the
    // count carried by UndecodableRecordsError is safe.
    const packet = buildCodec8Packet([buildCodec8Record({})], { numberOfData2: 9 })
    let thrown: unknown
    try {
      parseFrame(new StreamFramer().feed(packet)[0]!)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(FrameError)
    expect(thrown).not.toBeInstanceOf(UndecodableRecordsError)
  })
})
