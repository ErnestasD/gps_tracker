import type { Redis } from 'ioredis'
import { describe, expect, it } from 'vitest'

import { AvlTableCache, type AvlFallbackReason } from '../src/avlTableCache.js'
import { FALLBACK_AVL_TABLE } from '../src/normalize.js'

/**
 * The device→dictionary resolver, in isolation.
 *
 * The pipeline suite covers the happy paths end-to-end, but it cannot reach the case that matters
 * most here — Redis being unavailable — and that is exactly the branch whose caching semantics are
 * load-bearing: a failure must NOT be cached (or one blip holds a whole shard on the fallback for
 * a full TTL after it clears) and must NOT be reported as a fallback when the device still has a
 * usable table (or an operator pages on positions that are fine).
 */
const cfg = (avlTable?: string): string => JSON.stringify({ presenceRules: {}, odometerSource: 'auto', ...(avlTable !== undefined ? { avlTable } : {}) })

/** Minimal Redis stand-in: one `device:config` hash, and a switch that makes HMGET reject. */
function fakeRedis(hash: Record<string, string>): { redis: Redis; calls: () => number; fail: (on: boolean) => void } {
  let calls = 0
  let failing = false
  const redis = {
    hmget: (_key: string, ...fields: string[]) => {
      calls++
      return failing ? Promise.reject(new Error('READONLY You can\'t write against a read only replica')) : Promise.resolve(fields.map((f) => hash[f] ?? null))
    },
  } as unknown as Redis
  return { redis, calls: () => calls, fail: (on: boolean) => { failing = on } }
}

const collect = (): { reasons: AvlFallbackReason[]; on: (r: AvlFallbackReason) => void } => {
  const reasons: AvlFallbackReason[] = []
  return { reasons, on: (r) => reasons.push(r) }
}

describe('AvlTableCache', () => {
  it('resolves each device to its profile table, in ONE round trip for the batch', async () => {
    const r = fakeRedis({ '1': cfg('fmc650'), '2': cfg('tat100') })
    const c = new AvlTableCache(r.redis)
    const out = await c.resolveBatch([1n, 2n, 1n], 1_000)
    expect(out.get('1')).toBe('fmc650')
    expect(out.get('2')).toBe('tat100')
    expect(r.calls()).toBe(1) // …and the repeated device did not cost a second lookup
  })

  it('caches for the TTL, then re-reads — a profile change lands within a minute', async () => {
    const hash: Record<string, string> = { '1': cfg('fmc650') }
    const r = fakeRedis(hash)
    const c = new AvlTableCache(r.redis, 60_000)
    expect((await c.resolveBatch([1n], 1_000)).get('1')).toBe('fmc650')
    hash['1'] = cfg('tat100')
    expect((await c.resolveBatch([1n], 30_000)).get('1')).toBe('fmc650') // still cached
    expect((await c.resolveBatch([1n], 61_001)).get('1')).toBe('tat100')
    expect(r.calls()).toBe(2)
  })

  it('a Redis failure keeps the device\'s OWN table and reports nothing — it is not a fallback', async () => {
    // The bug this pins: a failure was reported as `redis_error` even when the device kept its own
    // table, because the reason came from the branch rather than the outcome. During a failover
    // every device whose 60 s TTL happened to expire incremented a counter documented as "decoded
    // with the wrong dictionary" while decoding perfectly correctly.
    const r = fakeRedis({ '1': cfg('fmc650') })
    const f = collect()
    const c = new AvlTableCache(r.redis, 60_000, f.on)
    expect((await c.resolveBatch([1n], 1_000)).get('1')).toBe('fmc650')
    r.fail(true)
    expect((await c.resolveBatch([1n], 61_001)).get('1')).toBe('fmc650') // stale, and still right
    expect(f.reasons).toEqual([])
  })

  it('…but a device with NO cached table during an outage falls back, and says so', async () => {
    const r = fakeRedis({ '9': cfg('fmc650') })
    const f = collect()
    const c = new AvlTableCache(r.redis, 60_000, f.on)
    r.fail(true)
    expect((await c.resolveBatch([9n], 1_000)).get('9')).toBe(FALLBACK_AVL_TABLE)
    expect(f.reasons).toEqual(['redis_error'])
  })

  it('a failure is NOT cached — the next batch retries instead of waiting out the TTL', async () => {
    // Caching it would hold the shard on the fallback for the full TTL after the blip cleared,
    // which turns a two-second incident into a minute of mislabelled attrs.
    const r = fakeRedis({ '9': cfg('fmc650') })
    const c = new AvlTableCache(r.redis, 60_000)
    r.fail(true)
    expect((await c.resolveBatch([9n], 1_000)).get('9')).toBe(FALLBACK_AVL_TABLE)
    r.fail(false)
    expect((await c.resolveBatch([9n], 1_100)).get('9')).toBe('fmc650') // same TTL window
  })

  it('every way the answer can be missing resolves to the fallback WITH its reason', async () => {
    const r = fakeRedis({ '1': cfg(), '2': 'not json', '3': cfg('fmb999'), '4': cfg('FMC650') })
    const f = collect()
    const c = new AvlTableCache(r.redis, 60_000, f.on)
    const out = await c.resolveBatch([1n, 2n, 3n, 4n, 5n], 1_000)
    expect(out.get('1')).toBe(FALLBACK_AVL_TABLE)
    expect(out.get('2')).toBe(FALLBACK_AVL_TABLE)
    expect(out.get('3')).toBe(FALLBACK_AVL_TABLE)
    expect(out.get('4')).toBe('fmc650') // a MODEL code resolves too, not only a table name
    expect(out.get('5')).toBe(FALLBACK_AVL_TABLE)
    expect(f.reasons.sort()).toEqual(['malformed', 'no_config', 'no_field', 'unknown_table'])
  })

  it('a profile whose table genuinely IS the fallback is not counted as one', async () => {
    // Otherwise the counter is a constant: 45 of the 105 catalogued models render exactly this
    // table, so the most common correct answer would look like the failure state.
    const r = fakeRedis({ '1': cfg(FALLBACK_AVL_TABLE) })
    const f = collect()
    const c = new AvlTableCache(r.redis, 60_000, f.on)
    expect((await c.resolveBatch([1n], 1_000)).get('1')).toBe(FALLBACK_AVL_TABLE)
    expect(f.reasons).toEqual([])
  })
})
