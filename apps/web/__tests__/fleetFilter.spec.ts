import { describe, expect, it } from 'vitest'

import { filterFleet, fleetCounts, sortFleet, type FleetFilter } from '../src/lib/fleetFilter'
import type { DeviceLive, DeviceStatus } from '../src/lib/liveStore'

/**
 * The fleet panel's arithmetic.
 *
 * These numbers are read as claims about a customer's fleet, so the property that matters most is
 * that the denominator never quietly changes meaning. This panel once showed "3 of 3" for a fleet
 * of eight because devices that had never reported were not counted as devices at all — the five
 * missing ones were indistinguishable from not existing.
 */
const dev = (id: string, status: DeviceStatus, speed: number | null = 0): DeviceLive =>
  ({ ev: { deviceId: id, speed } as DeviceLive['ev'], status, fix: { lon: 25, lat: 54, course: 0 } })

const label = (id: string) => ({ '1': 'Alfa (ABC 123)', '2': 'beta', '3': 'Gama', '10': 'Delta' })[id] ?? id

describe('fleetCounts', () => {
  it('counts every device in the fleet, including those that have never reported', () => {
    const c = fleetCounts([dev('1', 'online'), dev('2', 'stale'), dev('3', 'offline')], [{ id: '9', name: 'New' }])
    expect(c).toEqual({ online: 1, stale: 1, offline: 1, silent: 1, total: 4 })
  })

  it('an empty fleet is zeroes, not a crash', () => {
    expect(fleetCounts([], [])).toEqual({ online: 0, stale: 0, offline: 0, silent: 0, total: 0 })
  })
})

describe('filterFleet', () => {
  const devices = [dev('1', 'online'), dev('2', 'stale'), dev('3', 'offline')]
  const silent = [{ id: '9', name: 'Never called' }]

  it('a status filter narrows to that status and drops the silent bucket', () => {
    const r = filterFleet(devices, silent, { query: '', filter: 'online', label })
    expect(r.devices.map((d) => d.ev.deviceId)).toEqual(['1'])
    expect(r.silent).toEqual([])
  })

  it('the silent filter shows ONLY devices that have never reported', () => {
    const r = filterFleet(devices, silent, { query: '', filter: 'silent', label })
    expect(r.devices).toEqual([])
    expect(r.silent.map((d) => d.id)).toEqual(['9'])
  })

  it('search matches the label, which carries the plate an operator actually knows', () => {
    expect(filterFleet(devices, silent, { query: 'ABC', filter: 'all', label }).devices.map((d) => d.ev.deviceId)).toEqual(['1'])
    expect(filterFleet(devices, silent, { query: 'abc 1', filter: 'all', label }).devices).toHaveLength(1)
  })

  it('search reaches devices that have never reported too — they are the ones being looked for', () => {
    // A tracker was just added and has not connected: that is exactly when someone searches for it.
    const r = filterFleet(devices, silent, { query: 'never', filter: 'all', label })
    expect(r.devices).toEqual([])
    expect(r.silent.map((d) => d.id)).toEqual(['9'])
  })

  it('search and status compose', () => {
    const r = filterFleet(devices, silent, { query: 'alfa', filter: 'offline', label })
    expect(r.devices).toEqual([])
  })

  it('an unmatched query yields nothing rather than everything', () => {
    const r = filterFleet(devices, silent, { query: 'zzz', filter: 'all', label })
    expect(r.devices).toEqual([])
    expect(r.silent).toEqual([])
  })

  it('every filter value is handled', () => {
    for (const f of ['all', 'online', 'stale', 'offline', 'silent'] as FleetFilter[]) {
      expect(() => filterFleet(devices, silent, { query: '', filter: f, label }), f).not.toThrow()
    }
  })
})

describe('sortFleet', () => {
  it('by name, naturally — "Delta 10" after "Delta 2", not before', () => {
    const out = sortFleet([dev('10', 'online'), dev('2', 'online'), dev('1', 'online')], 'name', label)
    expect(out.map((d) => label(d.ev.deviceId))).toEqual(['Alfa (ABC 123)', 'beta', 'Delta'])
  })

  it('by speed, fastest first — and an UNKNOWN speed is not zero', () => {
    const out = sortFleet([dev('1', 'online', null), dev('2', 'online', 0), dev('3', 'online', 40)], 'speed', label)
    // 40 first, then the stationary 0, and the unknown last — reporting "unknown" as slowest would
    // put a device we know nothing about above one we know is parked.
    expect(out.map((d) => d.ev.speed)).toEqual([40, 0, null])
  })

  it('by status, liveliest first, then by name inside a status', () => {
    const out = sortFleet([dev('3', 'offline'), dev('2', 'stale'), dev('1', 'online')], 'status', label)
    expect(out.map((d) => d.status)).toEqual(['online', 'stale', 'offline'])
  })

  it('does not mutate its input', () => {
    const input = [dev('3', 'online'), dev('1', 'online')]
    const before = input.map((d) => d.ev.deviceId)
    sortFleet(input, 'name', label)
    expect(input.map((d) => d.ev.deviceId)).toEqual(before)
  })
})
