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

  it('an iButton drive emits AVL 78 that canonicalizes to the driver registry key (driver auto-resolution)', async () => {
    const hex = '0a1b2c3d4e5f6071'
    const packets = await collect(liveDrive.packets({ ...OPTS, ibutton: hex, can: true }))
    const codec = createTeltonikaCodec()
    const parsed = codec.parse(codec.feed(packets[0]!)[0]!)
    if (parsed.kind !== 'avl') expect.unreachable('avl expected')
    const rec = parsed.records[0]!
    // the worker's ibuttonKeyFromAvl(value) = String(bigint); the registry's ibuttonKeyFromHex(hex) =
    // BigInt('0x'+hex).toString(). They MUST match or a demo tap would silently never assign a driver.
    expect(String(rec.io.get(78))).toBe(BigInt('0x' + hex).toString())
    // CAN engine params present for the CAN panel
    expect(rec.io.get(85)).toBeGreaterThan(0n) // Engine RPM
    expect(rec.io.has(32)).toBe(true) // Coolant Temperature
    expect(rec.io.has(87)).toBe(true) // Total Mileage
  })

  it('a plain drive carries no iButton / CAN ids', async () => {
    const packets = await collect(liveDrive.packets(OPTS))
    const codec = createTeltonikaCodec()
    const rec = (codec.parse(codec.feed(packets[0]!)[0]!) as { records: { io: Map<number, unknown> }[] }).records[0]!
    expect(rec.io.has(78)).toBe(false)
    expect(rec.io.has(85)).toBe(false)
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

describe('panic scenario ↔ worker panic rule pairing (E08-5 review)', () => {
  it('emits an Alarm (AVL 236) rising EDGE mid-drive: 0 baseline everywhere, one 1 before the park tail', async () => {
    // The worker's `panic` rule kind edge-detects AVL 236 with a KNOWN-FALSE previous
    // value (apps/worker/src/rules/{io,engine}.ts). A scenario without the 236 baseline
    // (or with the panic landing in the parked tail) demos nothing — this pins the pairing.
    const { panic } = await import('../src/scenarios/panic.js')
    const opts: ScenarioOpts = { ...OPTS, count: 9, parkTailS: 240 }
    const packets = await collect(panic.packets(opts))
    const codec = createTeltonikaCodec()
    const alarms: { i: number; v: bigint; priority: number }[] = []
    for (const [i, pkt] of packets.entries()) {
      const parsed = codec.parse(codec.feed(pkt)[0]!)
      if (parsed.kind !== 'avl') expect.unreachable('avl expected')
      const rec = parsed.records[0]!
      const v = rec.io.get(236)
      expect(typeof v, `record ${i} must carry AVL 236`).toBe('bigint')
      alarms.push({ i, v: v as bigint, priority: rec.priority })
    }
    expect(packets.length).toBeGreaterThan(9) // drive + parked tail records
    const edges = alarms.filter((a) => a.v === 1n)
    expect(edges).toHaveLength(1) // exactly one alarm
    expect(edges[0]!.i).toBeLessThan(9) // mid-DRIVE, never inside the parked tail
    expect(edges[0]!.i).toBeGreaterThan(0) // a prior 236=0 record exists → rising edge
    expect(edges[0]!.priority).toBe(2) // §3.4 panic priority
  })
})
