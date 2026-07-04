import { describe, expect, it } from 'vitest'

import codec8 from '../__fixtures__/wiki/codec8.hex.json' with { type: 'json' }
import codec8e from '../__fixtures__/wiki/codec8e.hex.json' with { type: 'json' }
import codec12 from '../__fixtures__/wiki/codec12.hex.json' with { type: 'json' }
import codec1314 from '../__fixtures__/wiki/codec13-14.hex.json' with { type: 'json' }
import codec16 from '../__fixtures__/wiki/codec16.hex.json' with { type: 'json' }
import handshake from '../__fixtures__/wiki/handshake.hex.json' with { type: 'json' }
import { StreamFramer } from '../src/frame.js'
import { encodeCodec12 } from '../src/codec12.js'
import { parseFrame } from '../src/parse.js'
import { createTeltonikaCodec } from '../src/index.js'
import { hexBuf, type FixtureFile } from './helpers.js'

const corpus: FixtureFile[] = [
  codec8,
  codec8e,
  codec16,
  codec12,
  codec1314,
  handshake,
] as FixtureFile[]

describe('wiki golden corpus', () => {
  for (const file of corpus) {
    describe(file.source_url, () => {
      for (const c of file.cases) {
        if (c.encodeOf !== undefined) {
          it(`${c.name}: encodeCodec12(${c.encodeOf}) is byte-exact`, () => {
            expect(encodeCodec12(c.encodeOf!).toString('hex')).toBe(c.hex.toLowerCase())
          })
          continue
        }

        if (c.expectError !== undefined) {
          it(`${c.name}: rejected with ${c.expectError} (negative fixture, see note)`, () => {
            const frames = new StreamFramer().feed(hexBuf(c.hex))
            expect(frames).toHaveLength(1)
            expect(() => parseFrame(frames[0]!)).toThrow(
              c.expectError === 'CrcError' ? /CRC mismatch/ : /./,
            )
          })
          continue
        }

        it(`${c.name}: parses byte-exact`, () => {
          const framer = new StreamFramer()
          const frames = framer.feed(hexBuf(c.hex))
          expect(frames).toHaveLength(1)
          const parsed = parseFrame(frames[0]!)
          const exp = c.expect!

          expect(parsed.kind).toBe(exp.kind)
          if (parsed.kind === 'imei') {
            expect(parsed.imei).toBe(exp.imei)
            return
          }
          if (parsed.kind === 'cmdResponse') {
            expect(parsed.codec).toBe(exp.codec)
            if (exp.text !== undefined) expect(parsed.text).toBe(exp.text)
            if (exp.nack) expect(parsed.nack).toBe(true)
            return
          }

          expect(parsed.codec).toBe(exp.codec === 142 ? 0x8e : exp.codec)
          if (exp.rawFallback) {
            expect(parsed.rawFallback).toBe(true)
            return
          }
          expect(parsed.records).toHaveLength(exp.recordCount!)

          // walker exactness: record raws must tile the records region precisely
          const bytes = hexBuf(c.hex)
          const dataLen = bytes.readUInt32BE(4)
          const region = bytes.subarray(10, 8 + dataLen - 1)
          expect(Buffer.concat(parsed.records.map((r) => r.raw)).equals(region)).toBe(true)

          for (const [i, expRec] of (exp.records ?? []).entries()) {
            const rec = parsed.records[i]!
            for (const key of [
              'tsMs',
              'priority',
              'lat',
              'lon',
              'altitude',
              'angle',
              'satellites',
              'speed',
              'eventIoId',
            ] as const) {
              if (expRec[key] !== undefined) expect(rec[key], `${c.name}[${i}].${key}`).toBe(expRec[key])
            }
            for (const [id, val] of Object.entries(expRec.io ?? {})) {
              expect(rec.io.get(Number(id)), `${c.name}[${i}].io[${id}]`).toBe(BigInt(val))
            }
          }
        })
      }
    })
  }

  it('every fixture file carries provenance metadata (CLAUDE.md rule 8)', () => {
    for (const file of corpus) {
      expect(file.source_url).toMatch(/^https:\/\/wiki\.teltonika-gps\.com\/view\/Codec/)
      expect(file.retrieved_at).toBeTruthy()
      expect(file.attribution).toBeTruthy()
    }
  })

  it('handshake replies + ACK encode per wiki', () => {
    const codec = createTeltonikaCodec()
    const enc = (handshake as FixtureFile).encode!
    expect(codec.encodeImeiReply(true).toString('hex')).toBe(enc['imeiAccept'])
    expect(codec.encodeImeiReply(false).toString('hex')).toBe(enc['imeiReject'])
    expect(codec.encodeAck(1).toString('hex')).toBe(enc['ackOneRecord'])
    expect(codec.encodeAck(2).toString('hex')).toBe(enc['ackTwoRecords'])
  })
})
