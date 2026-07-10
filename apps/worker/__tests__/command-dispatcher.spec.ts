import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { runCommandDispatch } from '../src/commands/dispatcher.js'

const NOW = 1_800_000_000_000

/** Fake pool: records UPDATEs; the RETURNING expiry query yields the given expired ids. */
function fakePool(expiredIds: string[] = []) {
  const calls: { sql: string; params: unknown[] }[] = []
  const query = vi.fn((sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    if (sql.includes('expired') && sql.includes('RETURNING')) return Promise.resolve({ rows: expiredIds.map((id) => ({ id })), rowCount: expiredIds.length })
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
  return { pool: { query } as unknown as Pool, calls }
}

/** Fake redis modelling the per-device lists + the active set + push/trim/rem ops. */
function fakeRedis(state: { active: string[]; inflight: Record<string, string[]>; resp: Record<string, string[]>; pending?: Record<string, string[]> }) {
  const pending = state.pending ?? {}
  const ops: string[] = []
  return {
    ops,
    redis: {
      smembers: vi.fn(() => Promise.resolve(state.active)),
      lrange: vi.fn((key: string) => {
        const [, kind, dev] = key.split(':')
        const map = kind === 'inflight' ? state.inflight : kind === 'pending' ? pending : state.resp
        return Promise.resolve(map[dev!] ?? [])
      }),
      llen: vi.fn((key: string) => {
        const [, kind, dev] = key.split(':')
        const map = kind === 'inflight' ? state.inflight : pending
        return Promise.resolve((map[dev!] ?? []).length)
      }),
      ltrim: vi.fn((key: string, start: number) => {
        const dev = key.split(':')[2]!
        state.resp[dev] = (state.resp[dev] ?? []).slice(start)
        ops.push(`ltrim ${key} ${start}`)
        return Promise.resolve('OK')
      }),
      lrem: vi.fn((key: string, _count: number, value: string) => {
        const [, kind, dev] = key.split(':')
        const map = kind === 'inflight' ? state.inflight : pending
        map[dev!] = (map[dev!] ?? []).filter((v) => v !== value)
        ops.push(`lrem ${key}`)
        return Promise.resolve(1)
      }),
      rpush: vi.fn((key: string, value: string) => {
        const dev = key.split(':')[2]!
        ;(pending[dev] ??= []).push(value)
        ops.push(`rpush ${key} ${value}`)
        return Promise.resolve(1)
      }),
      del: vi.fn((key: string) => {
        const dev = key.split(':')[2]!
        state.resp[dev] = []
        ops.push(`del ${key}`)
        return Promise.resolve(1)
      }),
      expire: vi.fn((key: string) => {
        ops.push(`expire ${key}`)
        return Promise.resolve(1)
      }),
      srem: vi.fn((_k: string, dev: string) => {
        ops.push(`srem ${dev}`)
        return Promise.resolve(1)
      }),
    } as unknown as Redis,
    pending,
  }
}

const inflight = (id: string, sentAtMs: number, attempt = 0): string => JSON.stringify({ id, text: `t-${id}`, attempt, sentAtMs })

describe('E08-2 runCommandDispatch (glue)', () => {
  it('marks in-flight sent, acks a matched response, trims it, and clears the device when idle', async () => {
    const { pool, calls } = fakePool()
    const { redis, ops } = fakeRedis({ active: ['42'], inflight: { '42': [inflight('c1', NOW - 1000)] }, resp: { '42': [JSON.stringify({ text: 'OK', nack: false })] } })
    const r = await runCommandDispatch(pool, redis, NOW)
    expect(r.acked).toBe(1)
    // sent-mark + ack UPDATEs happened
    expect(calls.some((c) => c.sql.includes("status='sent'"))).toBe(true)
    expect(calls.some((c) => c.sql.includes("status='acked'") && c.params[0] === 'c1' && c.params[1] === 'OK')).toBe(true)
    expect(ops).toContain('ltrim cmd:resp:42 1') // consumed by head-count (append-safe, never del)
    expect(ops).toContain('srem 42') // nothing left → device removed from active
  })

  it('re-queues a timed-out command with retries left (DB→queued + rpush pending)', async () => {
    const { pool, calls } = fakePool()
    const { redis, pending } = fakeRedis({ active: ['42'], inflight: { '42': [inflight('c1', NOW - 31_000, 0)] }, resp: {} })
    const r = await runCommandDispatch(pool, redis, NOW)
    expect(r.acked).toBe(0)
    expect(calls.some((c) => c.sql.includes("status='queued'") && c.params[0] === 'c1')).toBe(true)
    expect(pending['42']).toHaveLength(1) // re-pushed for ingest to resend
    expect(JSON.parse(pending['42']![0]!)).toMatchObject({ id: 'c1', attempt: 1 })
  })

  it('fails a command timed out on its final attempt', async () => {
    const { pool, calls } = fakePool()
    const { redis } = fakeRedis({ active: ['42'], inflight: { '42': [inflight('c1', NOW - 31_000, 2)] }, resp: {} })
    const r = await runCommandDispatch(pool, redis, NOW)
    expect(r.failed).toBe(1)
    expect(calls.some((c) => c.sql.includes("status='failed'") && c.params[0] === 'c1')).toBe(true)
  })

  it('reports DB-expired commands (24h) even with no in-flight activity', async () => {
    const { pool } = fakePool(['old1', 'old2'])
    const { redis } = fakeRedis({ active: ['42'], inflight: {}, resp: {} })
    const r = await runCommandDispatch(pool, redis, NOW)
    expect(r.expired).toBe(2)
  })

  it('clears a stray orphan response when nothing is in flight (cannot mis-pair later)', async () => {
    const { pool } = fakePool()
    // a late reply arrived after its command already timed out and was cleaned up
    const { redis, ops } = fakeRedis({ active: ['42'], inflight: {}, resp: { '42': [JSON.stringify({ text: 'late OK', nack: false })] } })
    await runCommandDispatch(pool, redis, NOW)
    expect(ops).toContain('ltrim cmd:resp:42 1') // orphan trimmed by head-count, not left to poison the next command
    expect(ops).toContain('srem 42')
  })

  it('resent commands retain expiresAtMs so ingest can still expire them (never sent stale)', async () => {
    const { pool } = fakePool()
    const exp = NOW + 3_600_000 // 1h out — still valid, but must survive the resend
    const stale = JSON.stringify({ id: 'c1', text: 'setdigout 1', attempt: 0, sentAtMs: NOW - 31_000, expiresAtMs: exp })
    const { redis, pending } = fakeRedis({ active: ['42'], inflight: { '42': [stale] }, resp: {} })
    await runCommandDispatch(pool, redis, NOW)
    expect(pending['42']).toHaveLength(1)
    expect(JSON.parse(pending['42']![0]!)).toMatchObject({ id: 'c1', attempt: 1, expiresAtMs: exp })
  })

  it('a response appended AFTER the snapshot survives cleanup (no destructive del → no double-send)', async () => {
    // models the race: dispatcher LRANGEs resp=[R1]; while it awaits Postgres, ingest RPUSHes R2.
    // Cleanup must trim by the SNAPSHOT length (1), not `del` the whole list — else R2 is lost, the
    // next tick sees no reply for its command and wrongly resends it (double-execution).
    const { pool } = fakePool()
    const live = ['{"text":"R1","nack":false}', '{"text":"R2","nack":false}'] // R2 arrived post-snapshot
    let lrangeCalls = 0
    const ops: string[] = []
    const redis = {
      smembers: vi.fn(() => Promise.resolve(['42'])),
      lrange: vi.fn((key: string) => {
        if (key.startsWith('cmd:inflight')) return Promise.resolve(['{"id":"c1","text":"getinfo","attempt":0,"sentAtMs":' + (NOW - 1000) + '}'])
        if (key.startsWith('cmd:resp')) {
          lrangeCalls++
          return Promise.resolve(['{"text":"R1","nack":false}']) // STALE snapshot: only R1
        }
        return Promise.resolve([])
      }),
      llen: vi.fn(() => Promise.resolve(0)),
      ltrim: vi.fn((key: string, start: number) => {
        live.splice(0, start) // apply against the LIVE list (which already has R2)
        ops.push(`ltrim ${key} ${start}`)
        return Promise.resolve('OK')
      }),
      del: vi.fn((key: string) => {
        live.length = 0
        ops.push(`del ${key}`)
        return Promise.resolve(1)
      }),
      lrem: vi.fn(() => Promise.resolve(1)),
      rpush: vi.fn(() => Promise.resolve(1)),
      expire: vi.fn(() => Promise.resolve(1)),
      srem: vi.fn(() => Promise.resolve(1)),
    } as unknown as Redis
    await runCommandDispatch(pool, redis, NOW)
    expect(lrangeCalls).toBe(1)
    expect(ops).toContain('ltrim cmd:resp:42 1') // trimmed by snapshot length
    expect(ops.some((o) => o.startsWith('del'))).toBe(false) // never a destructive del
    expect(live).toEqual(['{"text":"R2","nack":false}']) // the post-snapshot reply survived
  })

  it('purges an expired pending entry before it can be drained + sent (destructive-safe)', async () => {
    const { pool, calls } = fakePool()
    const stale = JSON.stringify({ id: 'old', text: 'deleterecords', attempt: 0, expiresAtMs: NOW - 1000 })
    const { redis, ops } = fakeRedis({ active: ['42'], inflight: {}, resp: {}, pending: { '42': [stale] } })
    await runCommandDispatch(pool, redis, NOW)
    expect(calls.some((c) => c.sql.includes("status='expired'") && c.params?.[0] === 'old')).toBe(true)
    expect(ops).toContain('lrem cmd:pending:42') // removed from the queue → ingest never sends it
  })
})
