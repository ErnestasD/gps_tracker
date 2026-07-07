import { describe, expect, it } from 'vitest'

import { driveRecords } from '../src/drive.js'
import { planFleet, runFleet } from '../src/fleet.js'
import { liveDrive } from '../src/scenarios/liveDrive.js'
import { seedEntries } from '../src/seed.js'
import type { ScenarioOpts } from '../src/scenarios/types.js'

const BASE: ScenarioOpts = {
  imei: '356307042441013',
  seed: 7,
  hz: 1,
  count: 10,
  startMs: 1_751_600_000_000,
}

describe('planFleet', () => {
  it('derives imei base+i, seed base+i, spread offsets and staggered starts', () => {
    const plans = planFleet(BASE, { devices: 3, rampMs: 20, spreadM: 60 })
    expect(plans.map((p) => p.imei)).toEqual(['356307042441013', '356307042441014', '356307042441015'])
    expect(plans.map((p) => p.seed)).toEqual([7, 8, 9])
    expect(plans.map((p) => p.startDistanceM)).toEqual([0, 60, 120])
    expect(plans.map((p) => p.startDelayMs)).toEqual([0, 20, 40])
  })

  it('applies defaults (ramp 20 ms, spread 60 m) and scales to 500', () => {
    const plans = planFleet(BASE, { devices: 500 })
    expect(plans).toHaveLength(500)
    expect(plans[499]!.imei).toBe('356307042441512')
    expect(plans[499]!.startDistanceM).toBe(499 * 60)
    expect(plans[499]!.startDelayMs).toBe(499 * 20) // full ramp ≈ 10 s
    expect(new Set(plans.map((p) => p.imei)).size).toBe(500) // no collisions
  })
})

describe('runFleet resilience', () => {
  it('one connect failure cannot abort the fleet: unreachable port → counted, not thrown', async () => {
    // no listener on this port — every session throws ECONNREFUSED at connect
    const result = await runFleet(liveDrive, { ...BASE, count: 1, host: '127.0.0.1', port: 1 }, { devices: 3, rampMs: 0 })
    expect(result.devices).toBe(3)
    expect(result.failed).toBe(3)
    expect(result.sentPackets).toBe(0)
  })
})

describe('driveRecords startDistanceM', () => {
  it('spread devices start at distinct positions (same seed, different offset)', () => {
    const a = driveRecords({ seed: 1, count: 1, startMs: BASE.startMs })
    const b = driveRecords({ seed: 1, count: 1, startMs: BASE.startMs, startDistanceM: 600 })
    expect(a[0]!.lat === b[0]!.lat && a[0]!.lon === b[0]!.lon).toBe(false)
  })

  it('stays deterministic for a fixed offset', () => {
    const a = driveRecords({ seed: 3, count: 5, startMs: BASE.startMs, startDistanceM: 120 })
    const b = driveRecords({ seed: 3, count: 5, startMs: BASE.startMs, startDistanceM: 120 })
    expect(a).toEqual(b)
  })
})

describe('seedEntries', () => {
  it('matches planFleet imei derivation; deviceId is the NUMERIC imei (pipeline bigint)', () => {
    const entries = seedEntries(BASE.imei, 3)
    const plans = planFleet(BASE, { devices: 3 })
    expect(entries.map((e) => e.imei)).toEqual(plans.map((p) => p.imei))
    expect(entries[1]).toEqual({ imei: '356307042441014', deviceId: '356307042441014' })
    // ingest converts deviceId with BigInt() — a non-numeric id kills the session
    for (const e of entries) expect(() => BigInt(e.deviceId)).not.toThrow()
  })
})
