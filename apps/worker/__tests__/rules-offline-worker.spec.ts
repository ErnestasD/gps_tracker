import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { runOfflineSweep } from '../src/jobs/offlineWorker.js'

const H = 3_600_000
const NOW = 1_800_000_000_000

function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = []
  const query = vi.fn((sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return Promise.resolve({ rowCount: (sql.match(/\(\$/g) ?? []).length, rows: [] })
  })
  return { pool: { query } as unknown as Pool, calls }
}

/**
 * Fake redis for the sweep: device:tenant / device:account hashes, a pipeline that answers
 * hgetall(rule:tenant:*), hget(device:{id}:last), hget(device:config), exists(rule:offline:*),
 * and set/del on the flag. Records flag writes for assertions.
 */
function fakeRedis(opts: {
  tenant: Record<string, string>
  account: Record<string, string>
  rules: Record<string, Record<string, unknown>> // ruleId → stored rule
  lastFixMs: Record<string, number | null> // null / absent ⇒ never reported (real hget → null)
  config?: Record<string, unknown>
  flagged?: string[]
  claimed?: string[] // deviceIds whose SET NX should FAIL (already claimed by a concurrent sweep)
}) {
  const flagWrites: { op: 'set' | 'del'; key: string }[] = []
  const flagged = new Set(opts.flagged ?? [])
  const claimed = new Set(opts.claimed ?? [])
  const makePipe = () => {
    const ops: (() => unknown)[] = []
    const pipe: Record<string, unknown> = {
      hgetall: (key: string) => {
        ops.push(() => {
          const t = key.replace('rule:tenant:', '')
          const out: Record<string, string> = {}
          for (const [id, r] of Object.entries(opts.rules)) if ((r as { tenantId?: string }).tenantId === t) out[id] = JSON.stringify(r)
          return out
        })
        return pipe
      },
      hget: (key: string, field: string) => {
        ops.push(() => {
          if (key.endsWith(':last')) {
            const v = opts.lastFixMs[key.replace('device:', '').replace(':last', '')]
            return v == null ? null : String(v) // real ioredis: missing field ⇒ null
          }
          if (key === 'device:config') return opts.config ? JSON.stringify(opts.config) : null
          void field
          return null
        })
        return pipe
      },
      exists: (key: string) => {
        ops.push(() => (flagged.has(key.replace('rule:offline:', '')) ? 1 : 0))
        return pipe
      },
      set: (key: string) => {
        ops.push(() => {
          const id = key.replace('rule:offline:', '')
          if (claimed.has(id)) return null // SET NX loses → already claimed
          claimed.add(id)
          flagWrites.push({ op: 'set', key })
          return 'OK'
        })
        return pipe
      },
      del: (key: string) => {
        ops.push(() => {
          flagWrites.push({ op: 'del', key })
          return 1
        })
        return pipe
      },
      exec: () => Promise.resolve(ops.map((f) => [null, f()])),
    }
    return pipe
  }
  const redis = {
    hgetall: vi.fn((key: string) => Promise.resolve(key === 'device:tenant' ? opts.tenant : opts.account)),
    pipeline: vi.fn(() => makePipe()),
  } as unknown as Redis
  return { redis, flagWrites }
}

describe('E05-4b runOfflineSweep (glue)', () => {
  it('writes a device_offline event and sets the fired-flag for an offline device', async () => {
    const { pool, calls } = fakePool()
    const { redis, flagWrites } = fakeRedis({
      tenant: { '42': 'ten-1' },
      account: { '42': 'acc-1' },
      rules: { ro: { tenantId: 'ten-1', accountId: 'acc-1', kind: 'device_offline', config: { afterH: 2 } } },
      lastFixMs: { '42': NOW - 5 * H }, // 5 h > 2 h
    })
    const n = await runOfflineSweep(pool, redis, NOW)
    expect(n).toBe(1)
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO events'))!
    expect(insert.params.slice(0, 5)).toEqual(['ten-1', 'acc-1', '42', 'ro', 'device_offline'])
    expect(flagWrites).toContainEqual({ op: 'set', key: 'rule:offline:42' })
  })

  it('short-circuits when no device_offline rules exist (no event, no writes)', async () => {
    const { pool, calls } = fakePool()
    const { redis } = fakeRedis({
      tenant: { '42': 'ten-1' },
      account: { '42': 'acc-1' },
      rules: { rs: { tenantId: 'ten-1', accountId: 'acc-1', kind: 'overspeed' } }, // not device_offline
      lastFixMs: { '42': NOW - 50 * H },
    })
    const n = await runOfflineSweep(pool, redis, NOW)
    expect(n).toBe(0)
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO events'))).toBe(false)
  })

  it('clears the flag when a flagged device has recovered', async () => {
    const { pool } = fakePool()
    const { redis, flagWrites } = fakeRedis({
      tenant: { '42': 'ten-1' },
      account: { '42': 'acc-1' },
      rules: { ro: { tenantId: 'ten-1', accountId: 'acc-1', kind: 'device_offline', config: { afterH: 2 } } },
      lastFixMs: { '42': NOW - 1 * H }, // 1 h < 2 h → online
      flagged: ['42'],
    })
    const n = await runOfflineSweep(pool, redis, NOW)
    expect(n).toBe(0)
    expect(flagWrites).toContainEqual({ op: 'del', key: 'rule:offline:42' })
  })

  it('skips a device that has never reported (hget last ⇒ null)', async () => {
    const { pool, calls } = fakePool()
    const { redis, flagWrites } = fakeRedis({
      tenant: { '42': 'ten-1' },
      account: { '42': 'acc-1' },
      rules: { ro: { tenantId: 'ten-1', accountId: 'acc-1', kind: 'device_offline', config: { afterH: 2 } } },
      lastFixMs: {}, // no last fix → real hget returns null
    })
    const n = await runOfflineSweep(pool, redis, NOW)
    expect(n).toBe(0)
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO events'))).toBe(false)
    expect(flagWrites).toHaveLength(0)
  })

  it('does not double-fire when SET NX loses to a concurrent sweep (overlap guard)', async () => {
    const { pool, calls } = fakePool()
    // exists=0 (not yet flagged) so sweepOffline emits, but the NX claim is lost → no write
    const { redis } = fakeRedis({
      tenant: { '42': 'ten-1' },
      account: { '42': 'acc-1' },
      rules: { ro: { tenantId: 'ten-1', accountId: 'acc-1', kind: 'device_offline', config: { afterH: 2 } } },
      lastFixMs: { '42': NOW - 5 * H },
      claimed: ['42'], // a concurrent tick already claimed the flag
    })
    const n = await runOfflineSweep(pool, redis, NOW)
    expect(n).toBe(0)
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO events'))).toBe(false)
  })
})
