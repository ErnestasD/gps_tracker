import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import { GeofenceCache } from '../src/geofence/cache.js'

const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }
const gf = (accountId: string | null, name = 'g') => JSON.stringify({ accountId, name, geometry: square })

/** Fake redis with device:tenant/device:account hashes + geofence:tenant:* hashes. */
function fakeRedis(state: { tenant: Record<string, string>; account: Record<string, string>; fences: Record<string, Record<string, string>> }) {
  const hmget = vi.fn((key: string, ...fields: string[]) => {
    const map = key === 'device:tenant' ? state.tenant : key === 'device:account' ? state.account : {}
    return Promise.resolve(fields.map((f) => map[f] ?? null))
  })
  const hgetall = vi.fn((key: string) => Promise.resolve(state.fences[key.replace('geofence:tenant:', '')] ?? {}))
  return { redis: { hmget, hgetall } as unknown as Redis, hgetall }
}

describe('E05-2 GeofenceCache', () => {
  it('resolves a device to its tenant fences, filtered by account (shared + own)', async () => {
    const { redis } = fakeRedis({
      tenant: { '1': 'ten-A', '2': 'ten-A' },
      account: { '1': 'acc-X', '2': 'acc-Y' },
      fences: { 'ten-A': { g1: gf('acc-X', 'own'), g2: gf(null, 'shared'), g3: gf('acc-Y', 'other') } },
    })
    const cache = new GeofenceCache(redis, 30_000)
    const map = await cache.resolveBatch([1n, 2n], 0)
    // device 1 (acc-X): own g1 + shared g2, NOT g3
    expect((map.get('1') ?? []).map((g) => g.id).sort()).toEqual(['g1', 'g2'])
    // device 2 (acc-Y): g3 + shared g2
    expect((map.get('2') ?? []).map((g) => g.id).sort()).toEqual(['g2', 'g3'])
  })

  it('a device with no geofences / no registry entry is absent from the map', async () => {
    const { redis } = fakeRedis({ tenant: {}, account: {}, fences: {} })
    expect((await cacheOf(redis).resolveBatch([9n], 0)).has('9')).toBe(false)
  })

  it('caches a tenant fence set within the TTL (one hgetall) and refetches after', async () => {
    const { redis, hgetall } = fakeRedis({ tenant: { '1': 'ten-A' }, account: { '1': 'acc-X' }, fences: { 'ten-A': { g1: gf('acc-X') } } })
    const cache = new GeofenceCache(redis, 30_000)
    await cache.resolveBatch([1n], 0)
    await cache.resolveBatch([1n], 10_000) // within TTL
    expect(hgetall).toHaveBeenCalledTimes(1)
    await cache.resolveBatch([1n], 40_000) // past TTL
    expect(hgetall).toHaveBeenCalledTimes(2)
  })

  it('malformed fence JSON is skipped, never throws', async () => {
    const { redis } = fakeRedis({ tenant: { '1': 'ten-A' }, account: { '1': 'acc-X' }, fences: { 'ten-A': { bad: '{not json', g1: gf('acc-X') } } })
    const map = await cacheOf(redis, 30_000).resolveBatch([1n], 0)
    expect((map.get('1') ?? []).map((g) => g.id)).toEqual(['g1'])
  })
})

const cacheOf = (redis: Redis, ttl = 30_000) => new GeofenceCache(redis, ttl)
