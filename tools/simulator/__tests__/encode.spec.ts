import { describe, expect, it } from 'vitest'

import { createTeltonikaCodec, CrcError, FrameError, parseFrame } from '@orbetra/codec'

import { corruptCrc } from '../src/scenarios/corruptCrc.js'
import { liveDrive } from '../src/scenarios/liveDrive.js'
import { oversize } from '../src/scenarios/oversize.js'
import type { ScenarioOpts } from '../src/scenarios/types.js'

const OPTS: ScenarioOpts = {
  imei: '356307042441013',
  seed: 42,
  hz: 1,
  count: 30,
  startMs: Date.UTC(2026, 6, 4, 12, 0, 0),
}

async function collect(gen: Iterable<Buffer> | AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = []
  for await (const p of gen) out.push(p)
  return out
}

describe('simulator scenarios (E02-1)', () => {
  it('liveDrive emits protocol-valid frames that round-trip through @orbetra/codec', async () => {
    const packets = await collect(liveDrive.packets(OPTS))
    expect(packets).toHaveLength(OPTS.count)
    const codec = createTeltonikaCodec()
    let prevTs = 0
    for (const pkt of packets) {
      const frames = codec.feed(pkt)
      expect(frames).toHaveLength(1)
      const parsed = codec.parse(frames[0]!)
      if (parsed.kind !== 'avl') expect.unreachable('avl expected')
      expect(parsed.codec).toBe(8)
      expect(parsed.records).toHaveLength(1)
      const rec = parsed.records[0]!
      expect(rec.tsMs).toBeGreaterThan(prevTs)
      prevTs = rec.tsMs
      // on-route: inside the Vilnius loop bounding box
      expect(rec.lat).toBeGreaterThan(54.67)
      expect(rec.lat).toBeLessThan(54.7)
      expect(rec.lon).toBeGreaterThan(25.27)
      expect(rec.lon).toBeLessThan(25.31)
      expect(rec.speed).toBeGreaterThanOrEqual(30)
      expect(rec.speed).toBeLessThanOrEqual(70)
      expect(rec.io.get(239)).toBe(1n) // ignition on
      expect(rec.io.get(240)).toBe(1n) // movement on
      expect(rec.satellites).toBeGreaterThanOrEqual(8)
    }
  })

  it('same seed ⇒ byte-identical stream; different seed ⇒ different bytes', async () => {
    const a = Buffer.concat(await collect(liveDrive.packets(OPTS)))
    const b = Buffer.concat(await collect(liveDrive.packets({ ...OPTS })))
    const c = Buffer.concat(await collect(liveDrive.packets({ ...OPTS, seed: 43 })))
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })

  it('corruptCrc packets frame fine but fail CRC verification', async () => {
    const packets = await collect(corruptCrc.packets({ ...OPTS, count: 3 }))
    for (const pkt of packets) {
      const frames = createTeltonikaCodec().feed(pkt)
      expect(frames).toHaveLength(1)
      expect(() => parseFrame(frames[0]!)).toThrow(CrcError)
    }
  })

  it('oversize header is rejected by the framer (server closes socket)', async () => {
    const packets = await collect(oversize.packets({ ...OPTS, count: 1 }))
    expect(packets).toHaveLength(1)
    expect(() => createTeltonikaCodec().feed(packets[0]!)).toThrow(FrameError)
  })
})
