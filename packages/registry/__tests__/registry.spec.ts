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
    // the standalone write `activateDevice` uses for its CLAIM path (outside the MULTI)
    hset: (key: string, field: string, value: string) => {
      ops.push(`hset ${key}`)
      ;(hashes[key] ??= {})[field] = value
      return Promise.resolve(1)
    },
    // A tiny Lua interpreter for the TWO scripts this package ships, so the tests exercise the
    // SCRIPTS rather than a re-implementation of them: swap either guard for a blind command and
    // this fake stops guarding, which is the whole point. It dispatches on what the script DOES
    // (HDEL vs HSET) rather than on a name, so a renamed constant cannot silently take the wrong
    // branch. (The end-to-end guards also have real-Redis coverage in apps/api/__tests__.)
    eval: (script: string, _n: number, key: string, field: string, expected: string) => {
      evals.push({ keys: [key], args: [field, expected] })
      const h = (hashes[key] ??= {})
      if (script.includes('HSET')) {
        // HSET_IF_FREE_OR_MINE: write only when the field is absent or already ours
        const free = /cur\s*==\s*false/.test(script)
        const mine = /cur\s*==\s*ARGV\[2\]/.test(script)
        const cur = h[field]
        if ((free && cur === undefined) || (mine && cur === expected)) {
          h[field] = expected
          return Promise.resolve(1)
        }
        return Promise.resolve(0)
      }
      const guarded = /HGET[^)]*\)\s*==\s*ARGV\[2\]/.test(script)
      if (!guarded || h[field] === expected) delete h[field]
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

  it('activation does NOT steal an imei mapping that now points at another device', async () => {
    // The exact inverse of the teardown guard below, and it did not exist — the delete side carried
    // a guard and an essay, the write side was a blind HSET. Two callers replay a snapshot that is
    // seconds old (the boot rehydrate and the suspension restore walk), and the API serves CRUD
    // while the rehydrate runs, so a reclaim inside that window was undone by the replay.
    const { redis, hashes } = fakeRedis({ 'registry:imei': { '860000000000001': '99' } })
    await activateDevice(redis, { ...dev(7n, '860000000000001'), accountId: 'a1' })
    expect(hashes['registry:imei']?.['860000000000001']).toBe('99') // device 99 keeps it
  })

  it('…but a caller that has just proven the IMEI is free MAY claim it', async () => {
    // device create/import/claim run inside a DB transaction that refuses an IMEI held by any other
    // live device, backed by the partial unique index. There the DB is the authority and Redis is
    // merely catching up, so a stale mapping must be corrected rather than obeyed.
    const { redis, hashes } = fakeRedis({ 'registry:imei': { '860000000000001': '99' } })
    await activateDevice(redis, { ...dev(7n, '860000000000001'), accountId: 'a1' }, { claim: true })
    expect(hashes['registry:imei']?.['860000000000001']).toBe('7')
  })

  it('re-activating the SAME device is not a steal', async () => {
    const { redis, hashes } = fakeRedis({ 'registry:imei': { '860000000000001': '7' } })
    await activateDevice(redis, { ...dev(7n, '860000000000001'), accountId: 'a1' })
    expect(hashes['registry:imei']?.['860000000000001']).toBe('7')
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
    await restoreTenantDevices(redis, [{ ...dev(1n, 'a'), presenceRules: { minStopS: 120 }, odometerSource: 'can' }])
    expect(hashes['registry:imei']?.['a']).toBe('1')
    expect(hashes['device:account']?.['1']).toBe('a1')
    expect(hashes['device:config']?.['1']).toContain('odometerSource')
  })

  it('nests the trip config ITSELF — a caller cannot forget it and silently reset the fleet', async () => {
    // `RegistryDevice.config` is optional, so handing the flat DB rows to activateDevice typechecks
    // and skips device:config entirely: the fleet returns with default presence rules and GPS
    // odometry instead of CAN, and nobody notices because data is flowing. Three call sites did this
    // mapping by hand; the third forgot (review HIGH).
    const { redis, hashes } = fakeRedis()
    await restoreTenantDevices(redis, [{ ...dev(1n, 'a'), presenceRules: { minStopS: 120 }, odometerSource: 'can' }])
    expect(JSON.parse(hashes['device:config']!['1']!)).toEqual({ presenceRules: { minStopS: 120 }, odometerSource: 'can' })
  })

  it('suspend → restore → suspend is idempotent in both directions', async () => {
    const { redis, hashes } = fakeRedis()
    const one = [{ ...dev(1n, 'a'), presenceRules: {}, odometerSource: 'auto' }]
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
