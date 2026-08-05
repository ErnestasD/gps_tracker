import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import { RuleCache } from '../src/rules/cache.js'

interface Stored {
  accountId: string
  kind: string
  name: string
  config?: Record<string, unknown>
  cooldownS?: number
  enabled?: boolean
  scope?: Record<string, unknown>
}

/** Fake redis: device→tenant/account registry + `rule:tenant:{t}` hashes. */
function fakeRedis(tenant: Record<string, string>, account: Record<string, string>, rulesByTenant: Record<string, Record<string, Stored>>) {
  let hgetallCalls = 0
  const redis = {
    hmget: vi.fn((key: string, ...fields: string[]) => Promise.resolve(fields.map((f) => (key === 'device:tenant' ? tenant : account)[f] ?? null))),
    hgetall: vi.fn((key: string) => {
      hgetallCalls++
      const t = key.replace('rule:tenant:', '')
      const h = rulesByTenant[t] ?? {}
      return Promise.resolve(Object.fromEntries(Object.entries(h).map(([id, r]) => [id, JSON.stringify(r)])))
    }),
  } as unknown as Redis
  return Object.assign(redis, { calls: () => hgetallCalls })
}

describe('E05-4 RuleCache', () => {
  it('resolves a device to its account-scoped, enabled engine rules', async () => {
    const redis = fakeRedis(
      { '42': 'ten-1' },
      { '42': 'acc-1' },
      {
        'ten-1': {
          r1: { accountId: 'acc-1', kind: 'overspeed', name: 'Speed', config: { speedKmh: 80 }, cooldownS: 120 },
          r2: { accountId: 'acc-2', kind: 'panic', name: 'Other account' }, // wrong account
          r3: { accountId: 'acc-1', kind: 'geofence', name: 'Fence' }, // handled elsewhere
          r4: { accountId: 'acc-1', kind: 'ignition', name: 'Off', enabled: false }, // disabled
        },
      },
    )
    const out = await new RuleCache(redis).resolveBatch([42n], 1_000)
    const rules = out.get('42') ?? []
    expect(rules.map((r) => r.id)).toEqual(['r1'])
    expect(rules[0]).toMatchObject({ kind: 'overspeed', cooldownS: 120, config: { speedKmh: 80 } })
  })

  it('applies a config.scope.deviceIds allow-list', async () => {
    const redis = fakeRedis(
      { '42': 'ten-1', '43': 'ten-1' },
      { '42': 'acc-1', '43': 'acc-1' },
      { 'ten-1': { r1: { accountId: 'acc-1', kind: 'overspeed', name: 'Scoped', scope: { deviceIds: ['42'] } } } },
    )
    const out = await new RuleCache(redis).resolveBatch([42n, 43n], 1_000)
    expect(out.get('42')?.map((r) => r.id)).toEqual(['r1'])
    expect(out.get('43')).toBeUndefined() // 43 not in the allow-list
  })

  it('an OVERSIZE allow-list degrades to account-wide, and numeric ids still match', async () => {
    // The list is caller input consulted for every device in every batch, so the old
    // `list.map(String).includes(id)` was work a tenant admin could ask the pipeline to do on their
    // behalf indefinitely with one PATCH (audit MED). The API schema bounds it now; the cache reads
    // whatever is ALREADY in Redis, including rules written before that schema existed. Oversize
    // degrades to account-wide rather than dropping the rule: a rule firing too broadly is visible
    // and fixable, one that silently stopped firing is neither.
    const huge = Array.from({ length: 5_001 }, (_, i) => String(i))
    const redis = fakeRedis(
      { '42': 'ten-1' },
      { '42': 'acc-1' },
      {
        'ten-1': {
          big: { accountId: 'acc-1', kind: 'overspeed', name: 'Oversize', scope: { deviceIds: huge } },
          num: { accountId: 'acc-1', kind: 'overspeed', name: 'Numeric', scope: { deviceIds: [42] } },
        },
      },
    )
    const out = await new RuleCache(redis).resolveBatch([42n], 1_000)
    expect(out.get('42')?.map((r) => r.id).sort()).toEqual(['big', 'num'])
  })

  it('caches tenant rule sets within the TTL and reloads after it', async () => {
    const redis = fakeRedis({ '42': 'ten-1' }, { '42': 'acc-1' }, { 'ten-1': { r1: { accountId: 'acc-1', kind: 'overspeed', name: 'S' } } })
    const cache = new RuleCache(redis, 1_000)
    await cache.resolveBatch([42n], 0)
    await cache.resolveBatch([42n], 500) // within TTL → cached
    expect(redis.calls()).toBe(1)
    await cache.resolveBatch([42n], 2_000) // past TTL → reload
    expect(redis.calls()).toBe(2)
  })

  it('skips unregistered devices and malformed entries', async () => {
    const redis = fakeRedis({ '42': 'ten-1' }, { '42': 'acc-1' }, { 'ten-1': {} })
    const out = await new RuleCache(redis).resolveBatch([99n], 1_000) // 99 has no tenant
    expect(out.size).toBe(0)
  })
})
