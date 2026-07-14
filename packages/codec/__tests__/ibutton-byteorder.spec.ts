import { describe, expect, it } from 'vitest'

import { encodeAvlPacket, type EncodableRecord } from '../src/encode.js'
import { StreamFramer } from '../src/frame.js'
import { parseFrame } from '../src/parse.js'

/**
 * Golden byte-order pin for the iButton (AVL id 78, an 8-byte N8 element —
 * https://wiki.teltonika-gps.com/view/Codec#AVL_Data and the per-model AVL ID lists). Teltonika
 * IO values are BIG-ENDIAN. The driver registry stores the iButton and the pipeline derives its
 * canonical decimal from AVL 78; if the codec ever read this 8-byte value little-endian, a tap
 * would resolve the WRONG decimal — the safe direction is a MISS (no driver) rather than a
 * mis-assign, but either way this test freezes the correct big-endian reading end-to-end.
 */
const IBUTTON = 0x1122334455667788n // MSB non-zero ⇒ a genuine 8-byte (N8) value
const BE = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88])
const LE = Buffer.from([0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11])

const rec: EncodableRecord = {
  tsMs: 1_700_000_000_000, priority: 0, lat: 54.7, lon: 25.3,
  altitude: 100, angle: 90, satellites: 8, speed: 0, eventIoId: 0,
  io: new Map<number, bigint | Buffer>([[78, IBUTTON]]),
}

describe('iButton (AVL 78) byte order', () => {
  it('encodes the 8-byte iButton big-endian in the packet (not little-endian)', () => {
    const pkt = encodeAvlPacket(8, [rec])
    expect(pkt.includes(BE)).toBe(true)
    expect(pkt.includes(LE)).toBe(false) // a byte-reversed value must NOT appear
  })

  it('parses the 8-byte iButton back as the same big-endian value (round-trip)', () => {
    const pkt = encodeAvlPacket(8, [rec])
    const frame = new StreamFramer().feed(pkt)[0]!
    const parsed = parseFrame(frame)
    expect(parsed.kind).toBe('avl')
    if (parsed.kind !== 'avl') return
    expect(parsed.records[0]!.io.get(78)).toBe(IBUTTON) // exact value, not byte-reversed
  })
})
