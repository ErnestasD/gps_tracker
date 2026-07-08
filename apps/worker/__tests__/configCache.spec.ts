import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import { DeviceConfigCache } from '../src/trip/configCache.js'

function fakeRedis(store: Record<string, string>) {
  const hmget = vi.fn((_key: string, ...fields: string[]) => Promise.resolve(fields.map((f) => store[f] ?? null)))
  return { redis: { hmget } as unknown as Redis, hmget }
}

const cfg = (rules: object, odo: string) => JSON.stringify({ presenceRules: rules, odometerSource: odo })

describe('E04-5 DeviceConfigCache', () => {
  it('resolves configs from device:config and parses thresholds + odometerSource', async () => {
    const { redis } = fakeRedis({ '1': cfg({ noIgnition: true, moveSpeedKmh: 3 }, 'gps') })
    const cache = new DeviceConfigCache(redis, 60_000)
    const map = await cache.resolveBatch([1n, 2n], 1_000)
    expect(map.get('1')?.thresholds.noIgnition).toBe(true)
    expect(map.get('1')?.odometerSource).toBe('gps')
    expect(map.has('2')).toBe(false) // no config → engine default
  })

  it('caches within the TTL (one Redis read) and refetches after it expires', async () => {
    const { redis, hmget } = fakeRedis({ '1': cfg({}, 'auto') })
    const cache = new DeviceConfigCache(redis, 60_000)
    await cache.resolveBatch([1n], 0)
    await cache.resolveBatch([1n], 30_000) // within TTL → cached
    expect(hmget).toHaveBeenCalledTimes(1)
    await cache.resolveBatch([1n], 70_000) // past TTL → refetch
    expect(hmget).toHaveBeenCalledTimes(2)
  })

  it('only fetches stale ids, not the whole batch every time', async () => {
    const { redis, hmget } = fakeRedis({ '1': cfg({}, 'auto'), '2': cfg({}, 'device') })
    const cache = new DeviceConfigCache(redis, 60_000)
    await cache.resolveBatch([1n], 0) // fetches [1]
    await cache.resolveBatch([1n, 2n], 10_000) // 1 cached → fetches only [2]
    expect(hmget).toHaveBeenLastCalledWith('device:config', '2')
  })

  it('malformed JSON → treated as no config (never throws)', async () => {
    const { redis } = fakeRedis({ '1': '{not json' })
    const cache = new DeviceConfigCache(redis, 60_000)
    const map = await cache.resolveBatch([1n], 0)
    expect(map.has('1')).toBe(false)
  })
})
