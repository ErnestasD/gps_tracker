import { Redis } from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { NormalizedRecord } from '@orbetra/shared'

import { LiveState } from '../src/liveState.js'

let container: StartedTestContainer
let redis: Redis
let sub: Redis

beforeAll(async () => {
  container = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start()
  redis = new Redis(container.getMappedPort(6379), container.getHost(), {
    maxRetriesPerRequest: null,
  })
  sub = new Redis(container.getMappedPort(6379), container.getHost(), {
    maxRetriesPerRequest: null,
  })
}, 120_000)

afterAll(async () => {
  await redis.quit()
  await sub.quit()
  await container.stop()
})

beforeEach(async () => {
  await redis.flushall()
})

const rec = (fixTimeMs: number, lat = 54.7): NormalizedRecord => ({
  deviceId: 42n,
  fixTime: new Date(fixTimeMs),
  serverTime: new Date(),
  lat,
  lon: 25.3,
  altitude: 100,
  speed: 50,
  course: 90,
  satellites: 9,
  fixValid: true,
  ignition: true,
  movement: true,
  odometerM: null,
  priority: 0,
  recHash: 1n,
  attrs: {},
})

describe('LiveState (E02-4)', () => {
  it('updates last-position and publishes to live:{tenant}', async () => {
    await redis.hset('device:tenant', '42', 't1')
    const got = new Promise<string>((resolve) => {
      void sub.subscribe('live:t1')
      sub.once('message', (_ch, msg) => resolve(msg))
    })
    await new LiveState(redis).apply([rec(1_000_000)])
    const stored = await redis.hget('device:42:last', 'fixTimeMs')
    expect(stored).toBe('1000000')
    const published = JSON.parse(await got) as { deviceId: string; fixTimeMs: number }
    expect(published.deviceId).toBe('42')
    expect(published.fixTimeMs).toBe(1_000_000)
  })

  it('bufferedFlood old records do NOT regress last (max-wins, E02-4 AC)', async () => {
    const live = new LiveState(redis)
    await live.apply([rec(2_000_000, 55.0)])
    await live.apply([rec(1_000_000, 54.0)]) // late flood, older fix
    const stored = await redis.hget('device:42:last', 'fixTimeMs')
    expect(stored).toBe('2000000')
    const json = JSON.parse((await redis.hget('device:42:last', 'json'))!) as { lat: number }
    expect(json.lat).toBe(55.0)
  })

  it('takes the newest record per device even from an UNSORTED batch', async () => {
    await new LiveState(redis).apply([rec(1_000), rec(3_000), rec(2_000)])
    const stored = await redis.hget('device:42:last', 'fixTimeMs')
    expect(stored).toBe('3000')
  })

  it('CONCURRENT applies cannot regress the marker (review HIGH race)', async () => {
    const live = new LiveState(redis)
    // fire both without awaiting the first — per-device chaining must serialize them
    const pNew = live.apply([rec(9_000, 60.0)])
    const pOld = live.apply([rec(8_000, 59.0)])
    await Promise.all([pNew, pOld])
    expect(await redis.hget('device:42:last', 'fixTimeMs')).toBe('9000')
  })

  it('published payload carries accountId for in-memory WS filtering', async () => {
    await redis.hset('device:tenant', '42', 't1')
    await redis.hset('device:account', '42', 'acc-x')
    const got = new Promise<string>((resolve) => {
      void sub.subscribe('live:t1')
      sub.once('message', (_ch, msg) => resolve(msg))
    })
    await new LiveState(redis).apply([rec(7_777)])
    const published = JSON.parse(await got) as { accountId: string | null }
    expect(published.accountId).toBe('acc-x')
  })

  it('no tenant mapping → state stored, publish skipped (no channel yet)', async () => {
    await new LiveState(redis).apply([rec(5_000)])
    expect(await redis.hget('device:42:last', 'fixTimeMs')).toBe('5000')
  })
})

describe('LiveState — a failed applyOne does not poison the device chain (review HIGH)', () => {
  /** Minimal fake ioredis whose hget throws for the first N calls, then behaves. */
  function flakyRedis(failFirst: number) {
    const hashes = new Map<string, Record<string, string>>()
    let hgetCalls = 0
    return {
      hget: (key: string, field: string) => {
        if (key.endsWith(':last') && field === 'fixTimeMs') {
          hgetCalls++
          if (hgetCalls <= failFirst) return Promise.reject(new Error('redis blip'))
          return Promise.resolve(hashes.get(key)?.[field] ?? null)
        }
        return Promise.resolve(null)
      },
      hmget: () => Promise.resolve([null]),
      hset: (key: string, obj: Record<string, string>) => {
        hashes.set(key, { ...(hashes.get(key) ?? {}), ...obj })
        return Promise.resolve('OK')
      },
      publish: () => Promise.resolve(0),
    } as unknown as Redis
  }

  it('recovers on the NEXT apply after a transient failure (chain not left rejected)', async () => {
    const fake = flakyRedis(1) // first hget rejects, then works
    const live = new LiveState(fake)
    await expect(live.apply([rec(1_000)])).rejects.toThrow('redis blip') // surfaced, not swallowed
    // the device's chain must NOT be poisoned — a later apply for the same device still runs + persists
    await live.apply([rec(2_000)])
    expect(await fake.hget('device:42:last', 'fixTimeMs')).toBe('2000')
  })

  it('one device failing does not skip OTHER devices in the same batch', async () => {
    // fail exactly the first hget; device 42 sorts first alphabetically? order is Map insertion —
    // fail the first-processed device and assert the second still lands
    const fake = flakyRedis(1)
    const recFor = (id: bigint, ms: number): NormalizedRecord => ({ ...rec(ms), deviceId: id })
    const live = new LiveState(fake)
    await expect(live.apply([recFor(42n, 1_000), recFor(99n, 1_000)])).rejects.toThrow()
    // the non-failing device was still written despite the sibling's failure
    expect(await fake.hget('device:99:last', 'fixTimeMs')).toBe('1000')
  })
})
