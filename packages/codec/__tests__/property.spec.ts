import { describe, expect, it } from 'vitest'

import { encodeAvlPacket, type EncodableRecord } from '../src/encode.js'
import { StreamFramer } from '../src/frame.js'
import { parseFrame } from '../src/parse.js'

/**
 * Property: parse(encode(x)) ≡ x for generated records (E01-4 AC).
 * Seeded LCG keeps runs deterministic and reproducible (seed printed on failure)
 * without adding a PBT dependency.
 */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function genRecord(rnd: () => number, extended: boolean): EncodableRecord {
  const io = new Map<number, bigint | Buffer>()
  const idMax = extended ? 0xffff : 0xff
  const ioCount = Math.floor(rnd() * 6)
  for (let i = 0; i < ioCount; i++) {
    const id = 1 + Math.floor(rnd() * idMax)
    if (io.has(id)) continue
    const kind = rnd()
    if (extended && kind < 0.2) {
      const len = Math.floor(rnd() * 24)
      io.set(id, Buffer.from(Array.from({ length: len }, () => Math.floor(rnd() * 256))))
    } else if (kind < 0.4) {
      io.set(id, BigInt(Math.floor(rnd() * 2 ** 32)) * 65536n + BigInt(Math.floor(rnd() * 65536))) // 8B range
    } else {
      io.set(id, BigInt(Math.floor(rnd() * 2 ** 16)))
    }
  }
  return {
    tsMs: Date.UTC(2020, 0, 1) + Math.floor(rnd() * 4e11), // 2020..~2032
    priority: Math.floor(rnd() * 3) as 0 | 1 | 2,
    // generate on the 1e-7 grid so encode(round) is lossless
    lat: Math.round((rnd() * 180 - 90) * 1e7) / 1e7,
    lon: Math.round((rnd() * 360 - 180) * 1e7) / 1e7,
    altitude: Math.floor(rnd() * 9000) - 500,
    angle: Math.floor(rnd() * 360),
    satellites: Math.floor(rnd() * 24),
    speed: Math.floor(rnd() * 250),
    eventIoId: Math.floor(rnd() * (extended ? 0xffff : 0xff)),
    io,
  }
}

describe('property: parse(encode(x)) ≡ x', () => {
  for (const seed of [1, 42, 20260704]) {
    for (const codec of [8, 0x8e] as const) {
      it(`codec ${codec === 8 ? '8' : '8E'}, seed ${seed}, 60 packets`, () => {
        const rnd = lcg(seed + codec)
        for (let p = 0; p < 60; p++) {
          const extended = codec === 0x8e
          const records = Array.from({ length: 1 + Math.floor(rnd() * 9) }, () =>
            genRecord(rnd, extended),
          )
          const pkt = encodeAvlPacket(codec, records)
          const frames = new StreamFramer().feed(pkt)
          expect(frames).toHaveLength(1)
          const parsed = parseFrame(frames[0]!)
          if (parsed.kind !== 'avl') expect.unreachable('avl expected')
          expect(parsed.codec).toBe(codec)
          expect(parsed.records).toHaveLength(records.length)
          for (const [i, orig] of records.entries()) {
            const got = parsed.records[i]!
            const ctx = `seed=${seed} pkt=${p} rec=${i}`
            expect(got.tsMs, ctx).toBe(orig.tsMs)
            expect(got.priority, ctx).toBe(orig.priority)
            expect(got.lat, ctx).toBeCloseTo(orig.lat, 7)
            expect(got.lon, ctx).toBeCloseTo(orig.lon, 7)
            expect(got.altitude, ctx).toBe(orig.altitude)
            expect(got.angle, ctx).toBe(orig.angle)
            expect(got.satellites, ctx).toBe(orig.satellites)
            expect(got.speed, ctx).toBe(orig.speed)
            expect(got.eventIoId, ctx).toBe(orig.eventIoId)
            expect(got.io.size, ctx).toBe(orig.io.size)
            for (const [id, val] of orig.io) {
              const gotVal = got.io.get(id)
              if (Buffer.isBuffer(val)) {
                expect(Buffer.isBuffer(gotVal) && val.equals(gotVal), `${ctx} io[${id}]`).toBe(true)
              } else {
                expect(gotVal, `${ctx} io[${id}]`).toBe(val)
              }
            }
          }
        }
      })
    }
  }
})
