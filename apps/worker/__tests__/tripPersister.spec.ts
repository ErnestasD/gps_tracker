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

    await p.apply([openEv(42n)], 0)
    await p.apply([closeEv(42n)], 0)

    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO trips'))!
    expect(insert.params.slice(0, 3)).toEqual(['ten-1', 'acc-1', '42']) // scoped from the registry
    const update = calls.find((c) => c.sql.includes('UPDATE trips'))!
    expect(update.params[0]).toBe('100') // the id returned by the open insert
    expect(update.params).toContain(1234) // distanceM threaded through
  })

  it('an unregistered device (registry miss) writes NO trip, and its later close is dropped', async () => {
    const { pool, calls } = fakePool()
    const p = new TripPersister(pool, fakeRedis({})) // empty registry
    await p.apply([openEv(7n), closeEv(7n)], 0)
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO trips'))).toBe(false)
    expect(calls.some((c) => c.sql.includes('UPDATE trips'))).toBe(false)
  })

  it('a close with no known open (post-restart / skipped open) is dropped, never a wrong-row update', async () => {
    const { pool, calls } = fakePool()
    const p = new TripPersister(pool, fakeRedis({ '9': { t: 't', a: 'a' } }))
    await p.apply([closeEv(9n)], 0) // close arrives with no prior open in this process
    expect(calls.some((c) => c.sql.includes('UPDATE trips'))).toBe(false)
  })

  it('resolves the trip iButton to a driver (V2 Part B) and closes with COALESCE(driverId)', async () => {
    const { pool, calls } = fakePool()
    // device 42 in ten-1/acc-1. acc-1's map resolves 2712847316 → drv-9; a SIBLING account acc-2 has
    // a driver on the SAME key that must NEVER resolve for an acc-1 trip (account boundary).
    const redis = fakeRedis({ '42': { t: 'ten-1', a: 'acc-1' } }, {
      'ten-1:acc-1': { '2712847316': 'drv-9' },
      'ten-1:acc-2': { '2712847316': 'drv-OTHER' },
    })
    const p = new TripPersister(pool, redis)
    await p.apply([openEv(42n)], 0)
    await p.apply([closeEv(42n, '2712847316')], 0)
    const update = calls.find((c) => c.sql.includes('UPDATE trips'))!
    expect(update.sql).toContain('COALESCE("driverId"')
    expect(update.params[8]).toBe('drv-9') // acc-1's driver — never drv-OTHER from acc-2
    // a close with an UNKNOWN iButton resolves to null (no driver), never errors
    await p.apply([openEv(42n)], 0)
    await p.apply([closeEv(42n, '9999999999')], 0)
    const update2 = calls.filter((c) => c.sql.includes('UPDATE trips'))[1]!
    expect(update2.params[8]).toBeNull()
  })

  it('per-device open ids do not collide', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '1': { t: 't', a: 'a' }, '2': { t: 't', a: 'a' } })
    const p = new TripPersister(pool, redis)
    await p.apply([openEv(1n), openEv(2n), closeEv(1n), closeEv(2n)], 0)
    const updates = calls.filter((c) => c.sql.includes('UPDATE trips'))
    expect(updates).toHaveLength(2)
    expect(updates[0]!.params[0]).toBe('100') // device 1 → first insert id
    expect(updates[1]!.params[0]).toBe('101') // device 2 → second insert id
  })
})

describe('E04-1 TripPersister crash posture (audit high)', () => {
  /** Fake pool that answers the warm-start / orphan-sweep SELECTs with fixed rows. */
  const poolWith = (openRows: Record<string, unknown>[], orphanRows: Record<string, unknown>[], reconstructRows: Record<string, unknown>[] = []) => {
    const calls: { sql: string; params: unknown[] }[] = []
    const query = vi.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      if (/JOIN devices/.test(sql) && !/LEFT JOIN LATERAL/.test(sql)) return Promise.resolve({ rows: openRows, rowCount: openRows.length })
      // the force-close reconstruction: last valid fix + distance + peak, in one round trip.
      // Matched BEFORE the bare ST_Length branch, which it also contains.
      if (/CROSS JOIN LATERAL/.test(sql))
        return Promise.resolve({ rows: reconstructRows, rowCount: reconstructRows.length })
      if (/ST_Length/.test(sql)) return Promise.resolve({ rows: [{ m: '4321.6' }], rowCount: 1 })
      if (/LEFT JOIN LATERAL/.test(sql)) return Promise.resolve({ rows: orphanRows, rowCount: orphanRows.length })
      if (/^INSERT INTO trips/.test(sql)) return Promise.resolve({ rows: [{ id: 900 }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: 1 })
    })
    return { pool: { query } as unknown as Pool, calls }
  }

  it('warm-start lets a close after a restart finalize the RIGHT row', async () => {
    // Before: the in-memory map was lost on every restart and lease transfer, the close was dropped
    // ("no known open id"), and the row stayed `open` forever. Recompute does NOT reconcile those —
    // its DELETE is status='closed'-scoped and it only runs when a LATE record appears, which a
    // clean restart never produces. Reports aggregate trips with no status filter, so engineHours
    // billed those devices for `now() - startTime`, growing every day.
    const { pool, calls } = poolWith([{ id: '77', deviceId: '42', tenantId: 't1', accountId: 'a1' }], [])
    const p = new TripPersister(pool, fakeRedis({ '42': { t: 't1', a: 'a1' } }))
    expect(await p.warmStart([0, 1], 16)).toBe(1)
    const res = await p.apply([closeEv(42n)], 0)
    expect(res.closed).toBe(1)
    const upd = calls.find((c) => /UPDATE trips SET "status"='closed'/.test(c.sql))
    expect(upd?.params[0]).toBe('77') // the warm-started id, not a guess
  })

  it('a new open for a device that already has one closes the stale row first', async () => {
    // otherwise a restart mid-trip leaves TWO open rows for one device and reports double-count
    const { pool, calls } = poolWith([{ id: '77', deviceId: '42', tenantId: 't1', accountId: 'a1' }], [])
    const p = new TripPersister(pool, fakeRedis({ '42': { t: 't1', a: 'a1' } }))
    await p.warmStart([0, 1], 16)
    await p.apply([openEv(42n)], 0)
    const closes = calls.filter((c) => /UPDATE trips SET "status"='closed'/.test(c.sql))
    expect(closes).toHaveLength(1)
    expect(closes[0]!.params[0]).toBe('77')
    expect(calls.filter((c) => /^INSERT INTO trips/.test(c.sql))).toHaveLength(1) // and one fresh open
  })

  it('…and that stale row keeps the journey it actually drove, not zeros', async () => {
    // The restart case is a REAL trip: the row is open, the engine's memory is gone, and the next
    // journey force-closes it. Writing distanceM: 0 / maxSpeed: 0 reported "0 km, 0 km/h" for a
    // drive whose positions are durable and complete (founder, 2026-09-04: two of three trips that
    // day showed zeros against 499 positions at up to 100 km/h). It also ended the trip at the NEXT
    // one's start, billing the hours parked in between to it as duration.
    const lastFix = new Date(5_000)
    const { pool, calls } = poolWith(
      [{ id: '77', deviceId: '42', tenantId: 't1', accountId: 'a1', startTime: new Date(500) }],
      [],
      [{ fix_time: lastFix, lat: 54.9, lon: 25.9, max_speed: 102, m: '31166.4' }],
    )
    const p = new TripPersister(pool, fakeRedis({ '42': { t: 't1', a: 'a1' } }))
    await p.warmStart([0, 1], 16)
    await p.apply([openEv(42n)], 0) // openEv starts at 1_000 — the next journey

    const close = calls.find((c) => /UPDATE trips SET "status"='closed'/.test(c.sql))!
    expect(close.params).toContain(31166) // ST_Length over its own positions, rounded
    expect(close.params).toContain(102) // and the peak it actually reached
    expect(close.params[1]).toEqual(lastFix) // ends where it stopped, not at the next trip's start
    expect(close.params[2]).toBe(54.9)
    // the reconstruction window is the stale trip's OWN span, upper bound exclusive: the next
    // trip's first record belongs to the next trip
    const read = calls.find((c) => /CROSS JOIN LATERAL/.test(c.sql))!
    expect(read.params.slice(1)).toEqual([new Date(500), new Date(1_000)])
    expect(read.sql).toContain('fix_valid') // I5: an invalid fix measures nothing
  })

  it('a stale row with no valid fix of its own is closed honestly, not invented', async () => {
    const { pool, calls } = poolWith([{ id: '77', deviceId: '42', tenantId: 't1', accountId: 'a1', startTime: new Date(500) }], [], [])
    const p = new TripPersister(pool, fakeRedis({ '42': { t: 't1', a: 'a1' } }))
    await p.warmStart([0, 1], 16)
    await p.apply([openEv(42n)], 0)
    const close = calls.find((c) => /UPDATE trips SET "status"='closed'/.test(c.sql))!
    expect(close.params[1]).toEqual(new Date(1_000)) // falls back to the next trip's start
    expect(close.params).toContain(0)
  })

  it("closeOrphans finalizes with REAL figures from the trip's own positions, not placeholders", async () => {
    // The first draft wrote distanceM: 0 and enqueued a recompute to "repair" it. But recompute
    // DELETEs status='closed' rows in its window and rebuilds only what the engine re-emits — and
    // the canonical orphan is a device that stopped mid-drive, so there is no ignition-off tail and
    // no close is ever emitted. It deleted the row and inserted nothing: the placeholder was not
    // repaired, the trip was destroyed. The figures are computed here instead.
    const lastFix = new Date(1_700_000_000_000)
    const { pool, calls } = poolWith([], [{ id: '55', deviceId: '9', startTime: new Date(1), startLat: 54.1, startLon: 25.1, lastFix, lat: 54.5, lon: 25.5, maxSpeed: 92 }])
    const p = new TripPersister(pool, fakeRedis({}))
    expect(await p.closeOrphans(6 * 3_600_000, [0, 1], 16)).toBe(1)
    const upd = calls.find((c) => /UPDATE trips SET "status"='closed'/.test(c.sql))!
    expect(upd.params[0]).toBe('55')
    expect(upd.params[1]).toEqual(lastFix) // engine-hours stops at the truth, not at now()
    expect(upd.params[2]).toBe(54.5)
    expect(upd.params[4]).toBe(4322) // the track's real length, rounded
    expect(upd.params[6]).toBe(92) // and its real max speed
  })

  it('a swept trip with no positions ends where it STARTED, never at Null Island', async () => {
    const { pool, calls } = poolWith([], [{ id: '56', deviceId: '9', startTime: new Date(1), startLat: 54.1, startLon: 25.1, lastFix: null, lat: null, lon: null, maxSpeed: null }])
    const p = new TripPersister(pool, fakeRedis({}))
    await p.closeOrphans(6 * 3_600_000, [0, 1], 16)
    const upd = calls.find((c) => /UPDATE trips SET "status"='closed'/.test(c.sql))!
    expect(upd.params[2]).toBe(54.1) // (0,0) is the Gulf of Guinea and reverse-geocodes to nonsense
    expect(upd.params[3]).toBe(25.1)
  })

  it('forgetShard drops the ids for a shard handed to a peer', async () => {
    // the new owner warm-starts them and is authoritative; a later re-gain closing our stale id
    // would land as a silent 0-row UPDATE (closeTrip is WHERE status='open')
    const { pool, calls } = poolWith([{ id: '77', deviceId: '42', tenantId: 't1', accountId: 'a1', shard: 3 }], [])
    const p = new TripPersister(pool, fakeRedis({ '42': { t: 't1', a: 'a1' } }))
    await p.warmStart([3], 16)
    p.forgetShard(3)
    await p.apply([closeEv(42n)], 0)
    expect(calls.some((c) => /UPDATE trips SET "status"='closed'/.test(c.sql))).toBe(false)
  })
})

describe('the bookkeeping that keeps a close attributable', () => {
  it('a runtime-opened trip is forgotten on a handoff — not only warm-started ones', async () => {
    // `shardOf` was written ONLY by warmStart, so forgetShard skipped every trip this process had
    // opened itself: precisely the population a handoff most needs to release, and precisely the
    // trips whose ids a peer is about to warm-start for itself.
    const { pool } = fakePool()
    const redis = fakeRedis({ '42': { t: 'ten-1', a: 'acc-1' } })
    const p = new TripPersister(pool, redis)
    expect(await p.apply([openEv(42n)], 3)).toMatchObject({ opened: 1 })
    p.forgetShard(3)
    // the close now has no id to attach to — which is the CORRECT outcome after a handoff, and is
    // reported rather than counted as a success
    expect(await p.apply([closeEv(42n)], 3)).toEqual({ opened: 0, closed: 0, missed: 1 })
  })

  it('forgetShard leaves OTHER shards alone', async () => {
    const { pool } = fakePool()
    const redis = fakeRedis({ '42': { t: 'ten-1', a: 'acc-1' } })
    const p = new TripPersister(pool, redis)
    await p.apply([openEv(42n)], 3)
    p.forgetShard(7)
    expect(await p.apply([closeEv(42n)], 3)).toMatchObject({ closed: 1, missed: 0 })
  })

  it('a close that writes NO row is reported as missed, never as closed', async () => {
    // trips_closed_total used to increment on the 0-row no-op too, so every dropped close was
    // recorded as a success and the one metric that could expose the class instead concealed it.
    const calls: { sql: string }[] = []
    const query = vi.fn((sql: string) => {
      calls.push({ sql })
      if (/^INSERT INTO trips/.test(sql)) return Promise.resolve({ rows: [{ id: 100 }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: /^UPDATE trips/.test(sql) ? 0 : 1 }) // the row was already closed
    })
    const p = new TripPersister({ query } as unknown as Pool, fakeRedis({ '42': { t: 'ten-1', a: 'acc-1' } }))
    await p.apply([openEv(42n)], 1)
    expect(await p.apply([closeEv(42n)], 1)).toEqual({ opened: 0, closed: 0, missed: 1 })
  })

  it('the orphan sweep only takes fix_valid positions for the trip end', async () => {
    // it ended the trip at an INVALID fix's time and coordinates — (0,0) for sentinel firmware —
    // two lines under a comment explaining why Null Island must be avoided. It also decided WHETHER
    // a trip looked orphaned: a device parked underground reports satellites=0 on schedule, and
    // those rows kept the sweep's freshness check satisfied so the stranded trip stayed invisible.
    const { pool, calls } = fakePool()
    const p = new TripPersister(pool, fakeRedis({}))
    await p.closeOrphans(6 * 3_600_000, [0], 16)
    const sweep = calls.find((c) => /FROM trips t/.test(c.sql))!
    const lateral = sweep.sql.slice(sweep.sql.indexOf('SELECT fix_time, lat, lon'))
    expect(lateral.slice(0, lateral.indexOf('ORDER BY'))).toContain('fix_valid')
  })
})
