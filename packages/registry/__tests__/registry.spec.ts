import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'

import { activateDevice, deactivateDevice, restoreTenantDevices, suspendTenantDevices, tenantDevicesKey } from '../src/index.js'

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
    // the delete-if-mine Lua, faithfully: only removes when the mapping still points at this device
    eval: (_script: string, _n: number, key: string, field: string, expected: string) => {
      evals.push({ keys: [key], args: [field, expected] })
      const h = hashes[key]
      if (h?.[field] === expected) delete h[field]
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
    await restoreTenantDevices(redis, [{ ...dev(1n, 'a'), config: { presenceRules: {}, odometerSource: 'auto' } }])
    expect(hashes['registry:imei']?.['a']).toBe('1')
    expect(hashes['device:account']?.['1']).toBe('a1')
    expect(hashes['device:config']?.['1']).toContain('odometerSource')
  })

  it('suspend → restore → suspend is idempotent in both directions', async () => {
    const { redis, hashes } = fakeRedis()
    const one = [{ ...dev(1n, 'a') }]
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
