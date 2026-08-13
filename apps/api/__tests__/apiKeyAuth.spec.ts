import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import type { ApiKeyRepo, ApiKeyResolved } from '@orbetra/db'

import { createApiKeyAuth } from '../src/auth/apiKey.js'

const resolved: ApiKeyResolved = { id: 'key-1', tenantId: 'ten-1', accountId: 'acc-1', scopes: ['read'] }

function fakeRepo(byHash: ApiKeyResolved | null) {
  return {
    findActiveByHash: vi.fn(() => Promise.resolve(byHash)),
    touch: vi.fn(() => Promise.resolve()),
    list: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
  } as unknown as ApiKeyRepo
}

/** Fake redis counter — one shared count so a test can drive the rate limit. */
function fakeRedis(start = 0) {
  let n = start
  const expire = vi.fn(() => Promise.resolve(1))
  const redis = { incr: vi.fn(() => Promise.resolve(++n)), expire } as unknown as Redis
  return { redis, expire }
}

describe('E06-3 API-key auth', () => {
  it('resolves an active key to a read-only (viewer) AuthContext', async () => {
    const auth = createApiKeyAuth({ apiKeys: fakeRepo(resolved), redis: fakeRedis().redis, perMin: 600, now: () => 0 })
    const out = await auth.resolve('orb_live_whatever')
    expect(out).toEqual({ ok: { userId: 'key-1', tenantId: 'ten-1', accountId: 'acc-1', role: 'viewer' } })
  })

  it('omits accountId for a tenant-wide key (accountId null → tenant visibility)', async () => {
    const auth = createApiKeyAuth({ apiKeys: fakeRepo({ ...resolved, accountId: null }), redis: fakeRedis().redis, perMin: 600, now: () => 0 })
    const out = await auth.resolve('orb_live_x')
    expect(out).toEqual({ ok: { userId: 'key-1', tenantId: 'ten-1', role: 'viewer' } })
  })

  it('rejects an unknown or revoked key', async () => {
    const auth = createApiKeyAuth({ apiKeys: fakeRepo(null), redis: fakeRedis().redis, perMin: 600, now: () => 0 })
    expect(await auth.resolve('orb_live_bad')).toEqual({ error: 'unauthorized' })
  })

  it('rate-limits once the per-minute counter is exceeded, and says WHEN to retry', async () => {
    const auth = createApiKeyAuth({ apiKeys: fakeRepo(resolved), redis: fakeRedis(600).redis, perMin: 600, now: () => 0 })
    // counter starts at 600 → first incr returns 601 > 600 → limited.
    // `retryAfterS` is the whole point of the shape: the published docs promise a Retry-After header
    // on this 429, and the limiter is the only thing that knows when its fixed window rolls over.
    expect(await auth.resolve('orb_live_x')).toEqual({ error: 'rate_limited', retryAfterS: 60 })
  })

  it('counts Retry-After down within the window rather than always answering a full minute', async () => {
    // 42 s into the window ⇒ 18 s left. A flat 60 would park a well-behaved client for a window it
    // has already mostly waited out.
    const auth = createApiKeyAuth({ apiKeys: fakeRepo(resolved), redis: fakeRedis(600).redis, perMin: 600, now: () => 42_000 })
    expect(await auth.resolve('orb_live_x')).toEqual({ error: 'rate_limited', retryAfterS: 18 })
  })

  it('sets a TTL on the first request of a window', async () => {
    const { redis, expire } = fakeRedis()
    const auth = createApiKeyAuth({ apiKeys: fakeRepo(resolved), redis, perMin: 600, now: () => 0 })
    await auth.resolve('orb_live_x')
    expect(expire).toHaveBeenCalledWith('apikey:rl:key-1:0', 60)
  })
})
