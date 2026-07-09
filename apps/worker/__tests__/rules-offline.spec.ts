import { describe, expect, it } from 'vitest'

import { DEFAULT_OFFLINE_H, sweepOffline, type DeviceState, type OfflineRule } from '../src/rules/offline.js'

const H = 3_600_000
const NOW = 1_800_000_000_000

const dev = (o: Partial<DeviceState> & Pick<DeviceState, 'deviceId' | 'lastFixMs'>): DeviceState => ({
  tenantId: 'ten-1',
  accountId: 'acc-1',
  ...o,
})
const rulesFor = (rules: OfflineRule[]) => new Map([['acc-1', rules]])

describe('E05-4b device_offline sweeper', () => {
  it('fires when the last fix is older than the rule threshold', () => {
    const devices = [dev({ deviceId: '42', lastFixMs: NOW - 27 * H })] // 27 h > 26 h default
    const r = sweepOffline(devices, rulesFor([{ ruleId: 'ro', accountId: 'acc-1' }]), new Set(), NOW)
    expect(r.events).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ kind: 'device_offline', ruleId: 'ro', tenantId: 'ten-1', lat: null, lon: null })
    expect(r.events[0]!.payload).toMatchObject({ thresholdH: DEFAULT_OFFLINE_H, offlineH: 27 })
    expect(r.toFlag).toEqual(['42'])
  })

  it('respects config.afterH override', () => {
    const devices = [dev({ deviceId: '42', lastFixMs: NOW - 3 * H })] // 3 h
    const r = sweepOffline(devices, rulesFor([{ ruleId: 'ro', accountId: 'acc-1', afterH: 2 }]), new Set(), NOW)
    expect(r.events).toHaveLength(1)
    expect(r.events[0]!.payload).toMatchObject({ thresholdH: 2 })
  })

  it('uses the profile offlineAfterH when the rule has no override', () => {
    const devices = [dev({ deviceId: '42', lastFixMs: NOW - 5 * H, profileOfflineAfterH: 4 })]
    const r = sweepOffline(devices, rulesFor([{ ruleId: 'ro', accountId: 'acc-1' }]), new Set(), NOW)
    expect(r.events).toHaveLength(1)
    expect(r.events[0]!.payload).toMatchObject({ thresholdH: 4 })
  })

  it('does not re-fire while already flagged offline', () => {
    const devices = [dev({ deviceId: '42', lastFixMs: NOW - 40 * H })]
    const r = sweepOffline(devices, rulesFor([{ ruleId: 'ro', accountId: 'acc-1' }]), new Set(['42']), NOW)
    expect(r.events).toHaveLength(0)
    expect(r.toFlag).toEqual([])
  })

  it('clears the flag when a flagged device comes back online', () => {
    const devices = [dev({ deviceId: '42', lastFixMs: NOW - 1 * H })] // recent → online
    const r = sweepOffline(devices, rulesFor([{ ruleId: 'ro', accountId: 'acc-1' }]), new Set(['42']), NOW)
    expect(r.events).toHaveLength(0)
    expect(r.toClear).toEqual(['42'])
  })

  it('skips devices whose account has no device_offline rule', () => {
    const devices = [dev({ deviceId: '42', lastFixMs: NOW - 40 * H, accountId: 'acc-2' })]
    const r = sweepOffline(devices, rulesFor([{ ruleId: 'ro', accountId: 'acc-1' }]), new Set(), NOW)
    expect(r.events).toHaveLength(0)
  })

  it('skips a device that has never reported (null last fix)', () => {
    const devices = [dev({ deviceId: '42', lastFixMs: null })]
    const r = sweepOffline(devices, rulesFor([{ ruleId: 'ro', accountId: 'acc-1' }]), new Set(), NOW)
    expect(r.events).toHaveLength(0)
    expect(r.toFlag).toEqual([])
  })

  it('when multiple offline rules exist, the smallest threshold fires', () => {
    const devices = [dev({ deviceId: '42', lastFixMs: NOW - 5 * H })]
    const rules: OfflineRule[] = [
      { ruleId: 'big', accountId: 'acc-1', afterH: 26 },
      { ruleId: 'small', accountId: 'acc-1', afterH: 4 },
    ]
    const r = sweepOffline(devices, rulesFor(rules), new Set(), NOW)
    expect(r.events).toHaveLength(1)
    expect(r.events[0]!.ruleId).toBe('small')
  })
})
