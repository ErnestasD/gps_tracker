import { describe, expect, it } from 'vitest'

import { createTeltonikaCodec, parseFrame, StreamFramer } from '@orbetra/codec'

import { bufferedFlood } from '../src/scenarios/bufferedFlood.js'
import { invalidFix } from '../src/scenarios/invalidFix.js'
import { panic } from '../src/scenarios/panic.js'
import { slowLoris } from '../src/scenarios/slowLoris.js'
import type { ScenarioOpts } from '../src/scenarios/types.js'

const OPTS: ScenarioOpts = {
  imei: '356307042441013',
  seed: 11,
  hz: 0,
  count: 300,
  startMs: Date.UTC(2026, 6, 4, 12, 0, 0),
}

async function collect(gen: Iterable<Buffer> | AsyncIterable<Buffer>): Promise<Buffer[]> {
  const out: Buffer[] = []
  for await (const p of gen) out.push(p)
  return out
}

function parseAll(packets: Buffer[]) {
  const codec = createTeltonikaCodec()
  return packets.flatMap((pkt) => {
    const frames = codec.feed(pkt)
    expect(frames).toHaveLength(1)
    const parsed = parseFrame(frames[0]!)
    if (parsed.kind !== 'avl') expect.unreachable('avl expected')
    return parsed.records
  })
}

describe('E02-2 adversarial scenarios', () => {
  it('bufferedFlood: 300 records oldest-first over ~2h, packets packed to the 1280 B cap', async () => {
    const packets = await collect(bufferedFlood.packets(OPTS))
    // framing stress: packets must approach the cap and never exceed it
    expect(Math.max(...packets.map((p) => p.length))).toBeGreaterThan(1100)
    for (const p of packets) expect(p.length).toBeLessThanOrEqual(1280)
    // multi-record packets (a flood, not a live drip)
    expect(packets.length).toBeLessThan(50)

    const records = parseAll(packets)
    expect(records).toHaveLength(300)
    for (let i = 1; i < records.length; i++) {
      expect(records[i]!.tsMs).toBeGreaterThan(records[i - 1]!.tsMs) // oldest-first
    }
    const spanMs = records[records.length - 1]!.tsMs - records[0]!.tsMs
    expect(spanMs).toBeGreaterThan(1.9 * 3600 * 1000)
    expect(records[records.length - 1]!.tsMs).toBeLessThanOrEqual(OPTS.startMs)
  })

  it('invalidFix: sats=0 records carry the LAST VALID coords with angle=0 speed=0 (§3.4)', async () => {
    const records = parseAll(await collect(invalidFix.packets({ ...OPTS, count: 30 })))
    expect(records).toHaveLength(30)
    const invalid = records.filter((r) => r.satellites === 0)
    expect(invalid.length).toBe(10) // indices 2,5,…,29 — every 3rd of 30
    let lastValid = records[0]!
    for (const r of records) {
      if (r.satellites === 0) {
        expect(r.lat).toBe(lastValid.lat)
        expect(r.lon).toBe(lastValid.lon)
        expect(r.angle).toBe(0)
        expect(r.speed).toBe(0)
      } else {
        lastValid = r
      }
    }
  })

  it('panic: exactly one priority=2 record with DIN1=1 and eventIoId=1 (§3.4 PANIC)', async () => {
    const records = parseAll(await collect(panic.packets({ ...OPTS, count: 21 })))
    const panics = records.filter((r) => r.priority === 2)
    expect(panics).toHaveLength(1)
    expect(panics[0]!.eventIoId).toBe(1)
    expect(panics[0]!.io.get(1)).toBe(1n)
    expect(records.filter((r) => r.priority === 0)).toHaveLength(20)
  })

  it('slowLoris: valid single packet + 5000ms default byte delay declared', async () => {
    expect(slowLoris.byteDelayMs).toBe(5000)
    const packets = await collect(slowLoris.packets({ ...OPTS, count: 1 }))
    expect(packets).toHaveLength(1)
    const frames = new StreamFramer().feed(packets[0]!)
    expect(frames).toHaveLength(1)
    expect(parseFrame(frames[0]!).kind).toBe('avl')
  })
})
