import { describe, expect, it } from 'vitest'

import traccar from '../__fixtures__/traccar/packets.hex.json' with { type: 'json' }
import { StreamFramer } from '../src/frame.js'
import { parseFrame } from '../src/parse.js'
import { hexBuf, type FixtureFile } from './helpers.js'

const file = traccar as FixtureFile

describe('Traccar-harvested real packet corpus (Apache 2.0, attributed)', () => {
  it('carries attribution + license metadata', () => {
    expect(file.attribution).toMatch(/Apache/)
    expect(file.source_url).toMatch(/github\.com\/traccar/)
    expect(file.cases.length).toBeGreaterThanOrEqual(10)
  })

  for (const c of file.cases) {
    it(`${c.name}: parses without throw, exact record count, walker tiles region`, () => {
      const bytes = hexBuf(c.hex)
      const frames = new StreamFramer().feed(bytes)
      expect(frames).toHaveLength(1)
      const parsed = parseFrame(frames[0]!)
      if (parsed.kind !== 'avl') expect.unreachable('expected avl packet')
      expect(parsed.codec).toBe(c.expect!.codec === 142 ? 0x8e : c.expect!.codec)
      expect(parsed.records).toHaveLength(c.expect!.recordCount!)

      const dataLen = bytes.readUInt32BE(4)
      const region = bytes.subarray(10, 8 + dataLen - 1)
      expect(Buffer.concat(parsed.records.map((r) => r.raw)).equals(region)).toBe(true)

      for (const rec of parsed.records) {
        // real-world sanity: coordinates in range, timestamps in 2010..2035, io preserved
        expect(Math.abs(rec.lat)).toBeLessThanOrEqual(90)
        expect(Math.abs(rec.lon)).toBeLessThanOrEqual(180)
        expect(rec.tsMs).toBeGreaterThan(Date.UTC(2010, 0, 1))
        expect(rec.tsMs).toBeLessThan(Date.UTC(2035, 0, 1))
        expect(rec.priority).toBeLessThanOrEqual(2)
        // unknown AVL ids must be preserved, never dropped (PROJECT_PLAN §3.7)
        for (const [id, val] of rec.io) {
          expect(Number.isInteger(id)).toBe(true)
          expect(typeof val === 'bigint' || Buffer.isBuffer(val)).toBe(true)
        }
      }
    })
  }
})
