import type { Redis } from 'ioredis'
import { describe, expect, it, vi } from 'vitest'

import { removeRule, syncRule, type RuleRow } from '../src/routes/ruleRegistry.js'

const row: RuleRow = {
  id: 'rule-1',
  tenantId: 'ten-1',
  accountId: 'acc-1',
  kind: 'overspeed',
  name: 'Speeding',
  config: { speedKmh: 80 },
  scope: {},
  cooldownS: 120,
  enabled: true,
}

function fakeRedis() {
  const hset = vi.fn(() => Promise.resolve(1))
  const hdel = vi.fn(() => Promise.resolve(1))
  return { redis: { hset, hdel } as unknown as Redis, hset, hdel }
}

describe('E05-4 ruleRegistry sync (contract the worker RuleCache parses)', () => {
  it('syncRule writes the rule under rule:tenant:{tenantId} keyed by id', async () => {
    const { redis, hset } = fakeRedis()
    await syncRule(redis, row)
    expect(hset).toHaveBeenCalledTimes(1)
    const [key, field, val] = hset.mock.calls[0] as unknown as [string, string, string]
    expect(key).toBe('rule:tenant:ten-1')
    expect(field).toBe('rule-1')
    const parsed = JSON.parse(val) as Record<string, unknown>
    expect(parsed).toEqual({ accountId: 'acc-1', kind: 'overspeed', name: 'Speeding', config: { speedKmh: 80 }, cooldownS: 120, enabled: true, scope: {} })
  })

  it('does NOT sync channels (worker only decides if an event fires)', async () => {
    const { redis, hset } = fakeRedis()
    await syncRule(redis, { ...row, channels: [{ type: 'telegram' }] } as unknown as RuleRow)
    const val = (hset.mock.calls[0] as unknown as [string, string, string])[2]
    expect(val).not.toContain('telegram')
  })

  it('removeRule drops the field from the tenant hash', async () => {
    const { redis, hdel } = fakeRedis()
    await removeRule(redis, 'ten-1', 'rule-1')
    expect(hdel).toHaveBeenCalledWith('rule:tenant:ten-1', 'rule-1')
  })
})
