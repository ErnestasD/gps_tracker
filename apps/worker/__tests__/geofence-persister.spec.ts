import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { GeofenceTransition } from '../src/geofence/engine.js'
import { GeofenceEventPersister } from '../src/geofence/persister.js'

const tr = (deviceId: bigint, type: 'enter' | 'exit', atMs = 1_000): GeofenceTransition => ({
  deviceId, geofenceId: 'gf1', geofenceName: 'Depot', type, at: new Date(atMs), lat: 54.5, lon: 25.5,
})

function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = []
  const query = vi.fn((sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return Promise.resolve({ rowCount: (sql.match(/\(\$/g) ?? []).length, rows: [] })
  })
  return { pool: { query } as unknown as Pool, calls }
}

/**
 * Faithful-enough fake: a shared string store with SET NX semantics + del, plus hash writes, so the
 * claim-before-insert dedup (SET NX on `geofence:evt:*`) behaves across calls exactly as on real Redis.
 * pipeline() returns a fresh builder recording ops; exec() applies them and returns [err, reply] tuples.
 */
function fakeRedis(tenant: Record<string, string>, account: Record<string, string>) {
  const strings = new Map<string, string>()
  const stateWrites: { key: string; field: string; val: string }[] = []
  const makePipe = () => {
    const ops: (() => [null, unknown])[] = []
    const pipe: Record<string, unknown> = {}
    // called as set(key, val, 'EX', ttl, 'NX') — extra args are ignored; NX honoured below
    pipe['set'] = (key: string, val: string) => {
      ops.push(() => {
        if (strings.has(key)) return [null, null] // nil reply = already existed
        strings.set(key, val)
        return [null, 'OK']
      })
      return pipe
    }
    pipe['hset'] = (key: string, field: string, val: string) => {
      ops.push(() => { stateWrites.push({ key, field, val }); return [null, 1] })
      return pipe
    }
    pipe['exec'] = () => Promise.resolve(ops.map((op) => op()))
    return pipe
  }
  const redis = {
    hmget: vi.fn((key: string, ...fields: string[]) =>
      Promise.resolve(fields.map((f) => (key === 'device:tenant' ? tenant : account)[f] ?? null)),
    ),
    pipeline: vi.fn(() => makePipe()),
    del: vi.fn((...keys: string[]) => { for (const k of keys) strings.delete(k); return Promise.resolve(keys.length) }),
  } as unknown as Redis
  return Object.assign(redis, { __stateWrites: stateWrites, __strings: strings })
}

const insert = (calls: { sql: string; params: unknown[] }[]) => calls.filter((c) => c.sql.startsWith('INSERT INTO events'))

describe('E05-2 GeofenceEventPersister', () => {
  it('writes an event scoped from the registry (tenant/account, geofence payload)', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '42': 'ten-1' }, { '42': 'acc-1' })
    const written = await new GeofenceEventPersister(pool, redis).persist([tr(42n, 'enter')])
    expect(written).toHaveLength(1)
    const ins = insert(calls)[0]!
    expect(ins.params.slice(0, 4)).toEqual(['ten-1', 'acc-1', '42', 'geofence'])
    expect(ins.params[7]).toContain('"transition":"enter"') // payload json
    // durable confirmed-inside state written for engine warm-start (MED-1)
    expect((redis as unknown as { __stateWrites: { key: string; field: string; val: string }[] }).__stateWrites).toContainEqual({ key: 'geofence:state:42', field: 'gf1', val: '1' })
  })

  it('drops a transition for an unregistered device (no tenant/account) — never a guessed tenant', async () => {
    const { pool, calls } = fakePool()
    const written = await new GeofenceEventPersister(pool, fakeRedis({}, {})).persist([tr(7n, 'exit')])
    expect(written).toHaveLength(0)
    expect(insert(calls)).toHaveLength(0)
  })

  it('batches multiple transitions into one insert', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '1': 't', '2': 't' }, { '1': 'a', '2': 'a' })
    const written = await new GeofenceEventPersister(pool, redis).persist([tr(1n, 'enter'), tr(2n, 'enter')])
    expect(written).toHaveLength(2)
    expect(insert(calls)).toHaveLength(1) // single batched insert
  })

  it('replay-idempotent: the SAME crossing redelivered writes exactly ONE event + fires ONE webhook (review MED)', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '42': 'ten-1' }, { '42': 'acc-1' }) // one shared store across both persists
    const persister = new GeofenceEventPersister(pool, redis)
    const crossing = tr(42n, 'enter', 5_000)

    const first = await persister.persist([crossing])
    expect(first).toHaveLength(1) // fresh → written + returned (caller enqueues 1 webhook)

    // ACK-replay / at-least-once redelivery of the identical batch (same device/fence/type/at)
    const replay = await persister.persist([crossing])
    expect(replay).toHaveLength(0) // deduped → no second row, and NO webhook re-enqueued
    expect(insert(calls)).toHaveLength(1) // no double-effect: only the first insert ran
  })

  it('a genuinely distinct later crossing (different `at`) is NOT suppressed by the dedup key', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '42': 'ten-1' }, { '42': 'acc-1' })
    const persister = new GeofenceEventPersister(pool, redis)
    expect(await persister.persist([tr(42n, 'enter', 1_000)])).toHaveLength(1)
    expect(await persister.persist([tr(42n, 'exit', 2_000)])).toHaveLength(1)
    expect(await persister.persist([tr(42n, 'enter', 3_000)])).toHaveLength(1) // re-entry, later at → fires
    expect(insert(calls)).toHaveLength(3) // no lost-effect: every real crossing wrote a row
  })

  it('rolls the claim back on insert failure so a retry re-emits (no permanent suppression)', async () => {
    const redis = fakeRedis({ '42': 'ten-1' }, { '42': 'acc-1' })
    const crossing = tr(42n, 'enter', 9_000)
    // pool whose insert throws once, then succeeds
    let first = true
    const pool = { query: vi.fn(() => { if (first) { first = false; return Promise.reject(new Error('insert boom')) } return Promise.resolve({ rowCount: 1, rows: [] }) }) } as unknown as Pool
    const persister = new GeofenceEventPersister(pool, redis)

    await expect(persister.persist([crossing])).rejects.toThrow('insert boom')
    // the claim must have been released — otherwise the retry would be suppressed and the crossing lost
    expect((redis as unknown as { __strings: Map<string, string> }).__strings.size).toBe(0)
    const retry = await persister.persist([crossing])
    expect(retry).toHaveLength(1) // re-emitted on retry
  })
})
