import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { GeofenceTransition } from '../src/geofence/engine.js'
import { GeofenceEventPersister } from '../src/geofence/persister.js'

const tr = (deviceId: bigint, type: 'enter' | 'exit'): GeofenceTransition => ({
  deviceId, geofenceId: 'gf1', geofenceName: 'Depot', type, at: new Date(1_000), lat: 54.5, lon: 25.5,
})

function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = []
  const query = vi.fn((sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return Promise.resolve({ rowCount: (sql.match(/\(\$/g) ?? []).length, rows: [] })
  })
  return { pool: { query } as unknown as Pool, calls }
}
function fakeRedis(tenant: Record<string, string>, account: Record<string, string>) {
  const stateWrites: { key: string; field: string; val: string }[] = []
  const pipe = { hset: vi.fn((key: string, field: string, val: string) => { stateWrites.push({ key, field, val }); return pipe }), exec: vi.fn(() => Promise.resolve([])) }
  const redis = {
    hmget: vi.fn((key: string, ...fields: string[]) =>
      Promise.resolve(fields.map((f) => (key === 'device:tenant' ? tenant : account)[f] ?? null)),
    ),
    pipeline: vi.fn(() => pipe),
  } as unknown as Redis
  return Object.assign(redis, { __stateWrites: stateWrites })
}

describe('E05-2 GeofenceEventPersister', () => {
  it('writes an event scoped from the registry (tenant/account, geofence payload)', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '42': 'ten-1' }, { '42': 'acc-1' })
    const n = await new GeofenceEventPersister(pool, redis).persist([tr(42n, 'enter')])
    expect(n).toBe(1)
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO events'))!
    expect(insert.params.slice(0, 4)).toEqual(['ten-1', 'acc-1', '42', 'geofence'])
    expect(insert.params[7]).toContain('"transition":"enter"') // payload json
    // durable confirmed-inside state written for engine warm-start (MED-1)
    expect((redis as unknown as { __stateWrites: { key: string; field: string; val: string }[] }).__stateWrites).toContainEqual({ key: 'geofence:state:42', field: 'gf1', val: '1' })
  })

  it('drops a transition for an unregistered device (no tenant/account) — never a guessed tenant', async () => {
    const { pool, calls } = fakePool()
    const n = await new GeofenceEventPersister(pool, fakeRedis({}, {})).persist([tr(7n, 'exit')])
    expect(n).toBe(0)
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO events'))).toBe(false)
  })

  it('batches multiple transitions into one insert', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '1': 't', '2': 't' }, { '1': 'a', '2': 'a' })
    const n = await new GeofenceEventPersister(pool, redis).persist([tr(1n, 'enter'), tr(2n, 'enter')])
    expect(n).toBe(2)
    expect(calls.filter((c) => c.sql.startsWith('INSERT INTO events'))).toHaveLength(1) // single batched insert
  })
})
