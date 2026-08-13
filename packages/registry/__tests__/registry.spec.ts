import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'

import { activateDevice, deactivateDevice, restoreTenantDevices, suspendTenantDevices, syncDeviceConfig, tenantDevicesKey } from '../src/index.js'

/**
 * The registry is the switch that decides whether a tracker's data is accepted at all, and it now
 * has two writers — device CRUD in the api, and billing suspension in the worker (audit MED #22).
 * These tests pin the contract that both depend on.
 */
function fakeRedis(hashes: Record<string, Record<string, string>> = {}) {
  const sets = new Map<string, Set<string>>()
  const ops: string[] = []
  const chain: Record<string, unknown> = {}
  for (const m of ['hset', 'hdel', 'sadd', 'srem', 'del']) {
    chain[m] = (key: string, ...args: unknown[]) => {
      ops.push(`${m} ${key}`)
      if (m === 'sadd') { const set = sets.get(key) ?? new Set<string>(); sets.set(key, set); set.add(String(args[0])) }
      if (m === 'srem') sets.get(key)?.delete(String(args[0]))
      if (m === 'hset') (hashes[key] ??= {})[String(args[0])] = String(args[1])
      if (m === 'hdel') delete hashes[key]?.[String(args[0])]
      return chain
    }
  }
  chain['exec'] = () => Promise.resolve([])
  const evals: { keys: string[]; args: string[] }[] = []
  const redis = {
    hget: (key: string, field: string) => Promise.resolve(hashes[key]?.[field] ?? null),
    // DIRECT hset, not just the MULTI chain: `syncDeviceConfig` writes outside a transaction, and
    // its absence from this double is why the one writer of `device:config` with no test had none.
    hset: (key: string, field: string, value: string) => {
      ;(hashes[key] ??= {})[field] = value
      return Promise.resolve(1)
    },
    // A tiny Lua interpreter for the ONE script this package ships, so the test exercises the SCRIPT
    // rather than a re-implementation of it: swap `HDEL_IF_MINE` for a blind HDEL and this fake
    // stops guarding, which is the whole point. (The end-to-end guard also has real-Redis coverage
    // in apps/api/__tests__/devices.spec.ts; this is the unit that owns the string.)
    eval: (script: string, _n: number, key: string, field: string, expected: string) => {
      evals.push({ keys: [key], args: [field, expected] })
      const guarded = /HGET[^)]*\)\s*==\s*ARGV\[2\]/.test(script)
      const h = hashes[key]
      if (h !== undefined && (!guarded || h[field] === expected)) delete h[field]
      return Promise.resolve(1)
    },
    multi: () => chain,
  } as unknown as Redis
  return { redis, hashes, sets, ops, evals }
}

const dev = (id: bigint, imei: string, tenantId = 't1') => ({ id, imei, tenantId, accountId: 'a1' })

describe('activate / deactivate', () => {
  it('activation publishes the imei mapping, the tenant + account and the per-tenant index', async () => {
    const { redis, hashes, sets } = fakeRedis()
    await activateDevice(redis, dev(7n, '860000000000001'))
    expect(hashes['registry:imei']?.['860000000000001']).toBe('7')
    expect(hashes['device:tenant']?.['7']).toBe('t1')
    expect(hashes['device:account']?.['7']).toBe('a1')
    expect(sets.get(tenantDevicesKey('t1'))?.has('7')).toBe(true)
  })

  it('a device moving tenants leaves the OLD tenant’s index — otherwise it points at someone else’s device', async () => {
    const { redis, sets } = fakeRedis({ 'device:tenant': { '7': 'old-tenant' } })
    await activateDevice(redis, dev(7n, '860000000000001', 'new-tenant'))
    expect(sets.get(tenantDevicesKey('new-tenant'))?.has('7')).toBe(true)
    expect(sets.get(tenantDevicesKey('old-tenant'))?.has('7') ?? false).toBe(false)
  })

  it('teardown keeps `device:{id}:last` when asked — a suspension must look reversible', async () => {
    // retirement drops the last fix; a billing suspension must not, because NOTHING can rebuild it —
    // not activateDevice, not the boot rehydrate, only the next incoming position. Dropping it means
    // a customer who pays sees a blank map until every parked vehicle happens to report.
    const { redis, ops } = fakeRedis()
    await deactivateDevice(redis, dev(7n, 'a'), { keepLastFix: true })
    expect(ops.some((o) => o.startsWith('del device:7:last'))).toBe(false)
    const second = fakeRedis()
    await deactivateDevice(second.redis, dev(7n, 'a'))
    expect(second.ops.some((o) => o.startsWith('del device:7:last'))).toBe(true) // retirement still does
  })

  it('teardown removes the imei mapping ONLY while it still points at this device', async () => {
    // retiring frees an IMEI, so a repeat teardown must not steal the mapping of the LIVE device
    // that reclaimed it — that device would look fine in the UI while ingest refused its handshake
    const { redis, hashes } = fakeRedis({ 'registry:imei': { '860000000000001': '99' } })
    await deactivateDevice(redis, dev(7n, '860000000000001'))
    expect(hashes['registry:imei']?.['860000000000001']).toBe('99') // the reclaimer keeps it
  })
})

describe('tenant suspension', () => {
  it('suspending tears down EVERY device and reports the count', async () => {
    const { redis, hashes } = fakeRedis({ 'registry:imei': { a: '1', b: '2' }, 'device:tenant': { '1': 't1', '2': 't1' } })
    const n = await suspendTenantDevices(redis, [dev(1n, 'a'), dev(2n, 'b')])
    expect(n).toBe(2)
    expect(hashes['registry:imei']).toEqual({}) // ingest now refuses both on connect
    expect(hashes['device:tenant']).toEqual({})
  })

  it('restoring is the exact inverse, and rebuilds the ACCOUNT mapping too', async () => {
    // without device:account the device connects and is then dropped by the worker for want of a
    // tenant — a "restored" fleet that still shows nothing on the map
    const { redis, hashes } = fakeRedis()
    await restoreTenantDevices(redis, [{ ...dev(1n, 'a'), presenceRules: { minStopS: 120 }, odometerSource: 'can', avlTable: 'fmb120' }])
    expect(hashes['registry:imei']?.['a']).toBe('1')
    expect(hashes['device:account']?.['1']).toBe('a1')
    expect(hashes['device:config']?.['1']).toContain('odometerSource')
  })

  it('nests the trip config ITSELF — a caller cannot forget it and silently reset the fleet', async () => {
    // `RegistryDevice.config` is optional, so handing the flat DB rows to activateDevice typechecks
    // and skips device:config entirely: the fleet returns with default presence rules and GPS
    // odometry instead of CAN, and nobody notices because data is flowing. Three call sites did this
    // mapping by hand; the third forgot (review HIGH).
    //
    // avlTable joined that list: a restore REBUILDS device:config, so a field missing from these
    // rows is not merely un-updated, it is deleted — every device in a tenant that lapsed and paid
    // would come back decoding on the FMB120 fallback, with plausible-looking wrong attribute names
    // and no error anywhere. Exactly the drift this test exists to catch, one field later.
    const { redis, hashes } = fakeRedis()
    await restoreTenantDevices(redis, [{ ...dev(1n, 'a'), presenceRules: { minStopS: 120 }, odometerSource: 'can', avlTable: 'fmc650' }])
    expect(JSON.parse(hashes['device:config']!['1']!)).toEqual({ presenceRules: { minStopS: 120 }, odometerSource: 'can', avlTable: 'fmc650' })
  })

  it('syncDeviceConfig carries the avlTable — the PATCH path is how a wrong model gets corrected', async () => {
    // The one writer of `device:config` with no test at all. Dropping `avlTable` here survived the
    // registry, rehydrate and lapseSweep suites together — and it is precisely the path an operator
    // takes after picking the wrong model in the picker, so the headline fix of this whole change
    // would silently not apply to any device that was ever edited.
    const { redis, hashes } = fakeRedis()
    await syncDeviceConfig(redis, 1n, { minStopS: 120 }, 'can', 'fmc650')
    expect(JSON.parse(hashes['device:config']!['1']!)).toEqual({ presenceRules: { minStopS: 120 }, odometerSource: 'can', avlTable: 'fmc650' })
  })

  it('suspend → restore → suspend is idempotent in both directions', async () => {
    const { redis, hashes } = fakeRedis()
    const one = [{ ...dev(1n, 'a'), presenceRules: {}, odometerSource: 'auto', avlTable: 'fmb120' }]
    await restoreTenantDevices(redis, one)
    await restoreTenantDevices(redis, one)
    expect(hashes['registry:imei']?.['a']).toBe('1')
    await suspendTenantDevices(redis, one)
    await suspendTenantDevices(redis, one)
    expect(hashes['registry:imei']?.['a']).toBeUndefined()
  })

  it('an empty fleet suspends cleanly — a tenant with no devices is not an error', async () => {
    const { redis } = fakeRedis()
    expect(await suspendTenantDevices(redis, [])).toBe(0)
  })
})
