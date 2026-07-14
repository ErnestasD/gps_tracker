import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import { TripPersister } from '../src/trip/persister.js'
import type { CloseEvent, OpenEvent } from '../src/trip/engine.js'

const openEv = (deviceId: bigint): OpenEvent => ({ type: 'open', deviceId, startTime: new Date(1_000), startLat: 54, startLon: 25 })
const closeEv = (deviceId: bigint, ibutton: string | null = null): CloseEvent => ({
  type: 'close', deviceId, startTime: new Date(1_000), endTime: new Date(9_000),
  startLat: 54, startLon: 25, endLat: 54.1, endLon: 25.1, distanceM: 1234, distanceSource: 'gps', maxSpeed: 88, idleS: 60, ibutton,
})

/** Fake pg pool: INSERT ... RETURNING id yields a monotonic id; records all SQL. */
function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = []
  let nextId = 100
  const query = vi.fn((sql: string, params: unknown[]) => {
    calls.push({ sql, params })
    return Promise.resolve(/^INSERT INTO trips/.test(sql) ? { rows: [{ id: nextId++ }], rowCount: 1 } : { rows: [], rowCount: 1 })
  })
  return { pool: { query } as unknown as Pool, calls, query }
}

/** Fake redis registry: device:tenant / device:account hashes + optional driver:ibutton:{tenant}. */
function fakeRedis(map: Record<string, { t: string; a: string }>, drivers: Record<string, Record<string, string>> = {}) {
  return {
    hget: vi.fn((key: string, field: string) => {
      if (key.startsWith('driver:ibutton:')) return Promise.resolve(drivers[key.slice('driver:ibutton:'.length)]?.[field] ?? null)
      const e = map[field]
      if (!e) return Promise.resolve(null)
      return Promise.resolve(key === 'device:tenant' ? e.t : key === 'device:account' ? e.a : null)
    }),
  } as unknown as Redis
}

describe('E04-1 TripPersister', () => {
  it('opens then closes a trip for a registered device, threading the trip id', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '42': { t: 'ten-1', a: 'acc-1' } })
    const p = new TripPersister(pool, redis)

    await p.apply([openEv(42n)])
    await p.apply([closeEv(42n)])

    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO trips'))!
    expect(insert.params.slice(0, 3)).toEqual(['ten-1', 'acc-1', '42']) // scoped from the registry
    const update = calls.find((c) => c.sql.includes('UPDATE trips'))!
    expect(update.params[0]).toBe('100') // the id returned by the open insert
    expect(update.params).toContain(1234) // distanceM threaded through
  })

  it('an unregistered device (registry miss) writes NO trip, and its later close is dropped', async () => {
    const { pool, calls } = fakePool()
    const p = new TripPersister(pool, fakeRedis({})) // empty registry
    await p.apply([openEv(7n), closeEv(7n)])
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO trips'))).toBe(false)
    expect(calls.some((c) => c.sql.includes('UPDATE trips'))).toBe(false)
  })

  it('a close with no known open (post-restart / skipped open) is dropped, never a wrong-row update', async () => {
    const { pool, calls } = fakePool()
    const p = new TripPersister(pool, fakeRedis({ '9': { t: 't', a: 'a' } }))
    await p.apply([closeEv(9n)]) // close arrives with no prior open in this process
    expect(calls.some((c) => c.sql.includes('UPDATE trips'))).toBe(false)
  })

  it('resolves the trip iButton to a driver (V2 Part B) and closes with COALESCE(driverId)', async () => {
    const { pool, calls } = fakePool()
    // device 42 in tenant ten-1; the tenant's iButton map resolves key "2712847316" → driver drv-9
    const redis = fakeRedis({ '42': { t: 'ten-1', a: 'acc-1' } }, { 'ten-1': { '2712847316': 'drv-9' } })
    const p = new TripPersister(pool, redis)
    await p.apply([openEv(42n)])
    await p.apply([closeEv(42n, '2712847316')])
    const update = calls.find((c) => c.sql.includes('UPDATE trips'))!
    expect(update.sql).toContain('COALESCE("driverId"')
    expect(update.params[8]).toBe('drv-9') // resolved driver threaded as the 9th param
    // a close with an UNKNOWN iButton resolves to null (no driver), never errors
    await p.apply([openEv(42n)])
    await p.apply([closeEv(42n, '9999999999')])
    const update2 = calls.filter((c) => c.sql.includes('UPDATE trips'))[1]!
    expect(update2.params[8]).toBeNull()
  })

  it('per-device open ids do not collide', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '1': { t: 't', a: 'a' }, '2': { t: 't', a: 'a' } })
    const p = new TripPersister(pool, redis)
    await p.apply([openEv(1n), openEv(2n), closeEv(1n), closeEv(2n)])
    const updates = calls.filter((c) => c.sql.includes('UPDATE trips'))
    expect(updates).toHaveLength(2)
    expect(updates[0]!.params[0]).toBe('100') // device 1 → first insert id
    expect(updates[1]!.params[0]).toBe('101') // device 2 → second insert id
  })
})
