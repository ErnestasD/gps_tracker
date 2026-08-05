import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import type { DeviceIo } from '../src/rules/engine.js'
import { RulePersister } from '../src/rules/persister.js'
import type { RuleEvent } from '../src/rules/types.js'

const ev = (o: Partial<RuleEvent> & Pick<RuleEvent, 'kind'>): RuleEvent => ({
  deviceId: 42n,
  ruleId: `r-${o.kind}`,
  at: new Date(1_000),
  lat: 54.5,
  lon: 25.5,
  cooldownS: 300,
  bypassCooldown: false,
  payload: {},
  ...o,
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
 * Fake redis modelling the registry hmget plus the TWO gate stores: `SET NX` replay-dedup keys and
 * the fix-time cooldown script. `store` is a plain key→value map shared across persister instances,
 * which is how a redelivery or a second batch is simulated.
 */
function fakeRedis(tenant: Record<string, string>, account: Record<string, string>, store = new Map<string, string>()) {
  const setCmds: { key: string; args: unknown[] }[] = []
  const newPipe = () => {
    const queued: (() => [Error | null, unknown])[] = []
    const pipe: Record<string, unknown> = {
      set: (key: string, ...args: unknown[]) => {
        setCmds.push({ key, args })
        queued.push(() => {
          if (args.includes('NX') && store.has(key)) return [null, null]
          store.set(key, String(args[0]))
          return [null, 'OK']
        })
        return pipe
      },
      // COOLDOWN_SCRIPT, in JS: symmetric window against the LAST EMITTED event's fix time
      eval: (_script: string, _n: number, key: string, atMs: string, cooldownMs: string) => {
        queued.push(() => {
          const prev = store.get(key)
          if (prev !== undefined && Math.abs(Number(atMs) - Number(prev)) < Number(cooldownMs)) return [null, 0]
          store.set(key, atMs)
          return [null, 1]
        })
        return pipe
      },
      exec: () => Promise.resolve(queued.map((f) => f())),
    }
    return pipe
  }
  const redis = {
    hmget: vi.fn((key: string, ...fields: string[]) => Promise.resolve(fields.map((f) => (key === 'device:tenant' ? tenant : account)[f] ?? null))),
    pipeline: vi.fn(() => newPipe()),
    del: vi.fn((...keys: string[]) => {
      for (const k of keys) store.delete(k)
      return Promise.resolve(keys.length)
    }),
  } as unknown as Redis
  return Object.assign(redis, { __setCmds: setCmds, __store: store })
}

describe('E05-4 RulePersister — scope + cooldown', () => {
  it('writes an event with ruleId + kind, scoped from the registry', async () => {
    const { pool, calls } = fakePool()
    const redis = fakeRedis({ '42': 'ten-1' }, { '42': 'acc-1' })
    const n = await new RulePersister(pool, redis).persist([ev({ kind: 'overspeed', payload: { speedKmh: 100 } })])
    expect(n).toHaveLength(1)
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO events'))!
    expect(insert.sql).toContain('"ruleId"')
    expect(insert.params.slice(0, 5)).toEqual(['ten-1', 'acc-1', '42', 'r-overspeed', 'overspeed'])
  })

  it('drops an event for an unregistered device (never a guessed tenant)', async () => {
    const { pool, calls } = fakePool()
    const n = await new RulePersister(pool, fakeRedis({}, {})).persist([ev({ kind: 'panic', bypassCooldown: true })])
    expect(n).toHaveLength(0)
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO events'))).toBe(false)
  })

  it('cooldown suppresses a second same-rule event within the window', async () => {
    const { pool, calls } = fakePool()
    const shared = new Map<string, string>()
    const persister = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await persister.persist([ev({ kind: 'overspeed' })])).toHaveLength(1)
    // a DIFFERENT event (later fix time) of the same rule, still inside the 300 s window
    const p2 = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await p2.persist([ev({ kind: 'overspeed', at: new Date(61_000) })])).toHaveLength(0)
    expect(calls.filter((c) => c.sql.startsWith('INSERT INTO events'))).toHaveLength(1)
  })

  it('the cooldown is measured in FIX time, not wall clock — a buffered flush is not swallowed', async () => {
    // REGRESSION (audit MED). The gate was `SET NX EX cooldownS`, i.e. a WALL-CLOCK TTL. A device
    // that buffered six hours offline flushes all of it in one wall-clock second, so the first event
    // claimed the key and every genuinely distinct historical event behind it was silently dropped —
    // and the buffered-flood case is a stated V1 scenario, not a corner.
    const { pool } = fakePool()
    const shared = new Map<string, string>()
    const persister = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    const hour = 3_600_000
    const written = await persister.persist([
      ev({ kind: 'overspeed', at: new Date(hour * 1) }),
      ev({ kind: 'overspeed', at: new Date(hour * 2) }), // hours apart in the DEVICE's clock…
      ev({ kind: 'overspeed', at: new Date(hour * 3) }), // …though one wall-clock instant here
    ])
    expect(written).toHaveLength(3)
    // …while two events genuinely within the window still collapse to one
    const p2 = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await p2.persist([ev({ kind: 'overspeed', at: new Date(hour * 3 + 60_000) })])).toHaveLength(0)
  })

  it('the window is symmetric — a flush arrives out of order and must not re-alert backwards', async () => {
    const { pool } = fakePool()
    const shared = new Map<string, string>()
    const p1 = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await p1.persist([ev({ kind: 'overspeed', at: new Date(600_000) })])).toHaveLength(1)
    const p2 = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    // 60 s EARLIER than the one already emitted: same burst, seen out of order
    expect(await p2.persist([ev({ kind: 'overspeed', at: new Date(540_000) })])).toHaveLength(0)
  })

  it('panic + power_cut bypass the cooldown, but NOT the replay dedup', async () => {
    const { pool } = fakePool()
    const shared = new Map<string, string>()
    const persister = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await persister.persist([ev({ kind: 'panic', bypassCooldown: true })])).toHaveLength(1)
    // a genuinely SECOND panic (its own fix time) is always written — no cooldown applies
    const p2 = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await p2.persist([ev({ kind: 'panic', bypassCooldown: true, at: new Date(2_000) })])).toHaveLength(1)
    // …but a REDELIVERY of the first one (same identity) is not a second panic. The old code let it
    // through — "a doubled panic beats a missed one" — because a claimed key plus a failed INSERT
    // lost the alert; releasing the keys on insert failure removes that trade-off.
    const p3 = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await p3.persist([ev({ kind: 'panic', bypassCooldown: true })])).toHaveLength(0)
  })

  it('a mixed batch keeps bypass + passing-gated events in order, drops the blocked one (index alignment)', async () => {
    const { pool } = fakePool()
    // pre-seed the overspeed cooldown key so it is BLOCKED; ignition is fresh → passes
    const preset = new Map<string, string>([['rule:cd:r-overspeed:42', '1000']])
    const persister = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, preset))
    const written = await persister.persist([
      ev({ kind: 'overspeed' }), // gated + blocked → dropped
      ev({ kind: 'panic', bypassCooldown: true }), // bypass → kept
      ev({ kind: 'ignition' }), // gated + fresh → kept
      ev({ kind: 'power_cut', bypassCooldown: true }), // bypass → kept
    ])
    expect(written.map((e) => e.kind)).toEqual(['panic', 'ignition', 'power_cut'])
  })

  it('a cooldownS of 0 disables the cooldown but STILL dedupes a redelivery', async () => {
    // REGRESSION (audit MED). Dedup used to be the cooldown key's second job, so `cooldownS: 0` — a
    // perfectly ordinary "alert on every occurrence" setting — had no dedup at all, and `onBatch`
    // running before `XACK` meant every redelivered batch wrote a duplicate alert row.
    const { pool } = fakePool()
    const shared = new Map<string, string>()
    const persister = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await persister.persist([ev({ kind: 'ignition', cooldownS: 0 })])).toHaveLength(1)
    // a genuinely new occurrence still fires — the gate is on identity, never on rate
    const p2 = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await p2.persist([ev({ kind: 'ignition', cooldownS: 0, at: new Date(2_000) })])).toHaveLength(1)
    // …but the SAME event redelivered does not
    const p3 = new RulePersister(pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await p3.persist([ev({ kind: 'ignition', cooldownS: 0 })])).toHaveLength(0)
  })

  it('a FAILED insert releases BOTH claimed keys so a replay re-emits (no permanent suppression)', async () => {
    // pool.query throws on the INSERT → every key claimed for this event must be released, or the
    // replay that is supposed to compensate finds them set and the alert is lost for good
    const throwingPool = { query: vi.fn(() => Promise.reject(new Error('db down'))) } as unknown as Pool
    const shared = new Map<string, string>()
    const redis = fakeRedis({ '42': 't' }, { '42': 'a' }, shared)
    const persister = new RulePersister(throwingPool, redis)
    await expect(persister.persist([ev({ kind: 'overspeed' })])).rejects.toThrow('db down')
    expect([...shared.keys()]).toEqual([]) // dedup key AND cooldown key both released
    // a subsequent (recovered) attempt is NOT suppressed by a stale key → the alert is re-emitted
    const ok = new RulePersister(fakePool().pool, fakeRedis({ '42': 't' }, { '42': 'a' }, shared))
    expect(await ok.persist([ev({ kind: 'overspeed' })])).toHaveLength(1)
  })

  it('a Redis command error on the cooldown SET emits the event (never a silent drop)', async () => {
    const { pool, calls } = fakePool()
    // model an errored reply: [Error, undefined] — indistinguishable from a nil under the old code
    const pipe: Record<string, unknown> = {
      set: vi.fn(() => pipe),
      eval: vi.fn(() => pipe),
      exec: vi.fn(() => Promise.resolve([[new Error('LOADING'), undefined]])),
    }
    const redis = {
      hmget: vi.fn((key: string, ...fields: string[]) => Promise.resolve(fields.map(() => (key === 'device:tenant' ? 't' : 'a')))),
      pipeline: vi.fn(() => pipe),
    } as unknown as Redis
    const written = await new RulePersister(pool, redis).persist([ev({ kind: 'overspeed' })])
    expect(written).toHaveLength(1) // emitted despite the Redis error
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO events'))).toBe(true)
  })
})

describe('E05-4 RulePersister — IO baseline clearing (fuel_theft warm-start)', () => {
  it('HDELs a fuelBasePct/fuelBaseL that became null while DRIVING (no stale parked baseline)', async () => {
    const { pool } = fakePool()
    const store: Record<string, Record<string, string>> = { 'rule:iostate:9': { fuelBasePct: '80', fuelBaseL: '60', ignition: '0' } }
    const dels: { key: string; fields: string[] }[] = []
    const pipe = {
      hset: vi.fn((key: string, fields: Record<string, string>) => {
        store[key] = { ...(store[key] ?? {}), ...fields }
        return pipe
      }),
      hdel: vi.fn((key: string, ...fields: string[]) => {
        dels.push({ key, fields })
        for (const f of fields) delete store[key]?.[f]
        return pipe
      }),
      exec: vi.fn(() => Promise.resolve([])),
    }
    const redis = { pipeline: vi.fn(() => pipe) } as unknown as Redis
    // driving snapshot: baseline is null (engine clears it while ignition on)
    await new RulePersister(pool, redis).saveIoState(
      new Map([['9', { ignition: true, din1: null, unplug: null, alarm: null, fuelPct: 40, fuelL: 30, fuelBasePct: null, fuelBaseL: null }]]),
    )
    // the stale parked baseline must be gone (else a restart re-fires a false fuel_theft with drop=40)
    expect(store['rule:iostate:9']).not.toHaveProperty('fuelBasePct')
    expect(store['rule:iostate:9']).not.toHaveProperty('fuelBaseL')
    expect(dels.some((d) => d.fields.includes('fuelBasePct') && d.fields.includes('fuelBaseL'))).toBe(true)
  })
})

describe('E05-4 RulePersister — IO state round-trip', () => {
  it('saves and warm-starts the IO snapshot', async () => {
    const { pool } = fakePool()
    const store: Record<string, Record<string, string>> = {}
    const pipe = {
      hset: vi.fn((key: string, fields: Record<string, string>) => {
        store[key] = { ...(store[key] ?? {}), ...fields }
        return pipe
      }),
      hdel: vi.fn((key: string, ...fields: string[]) => {
        for (const f of fields) delete store[key]?.[f]
        return pipe
      }),
      hgetall: vi.fn((key: string) => {
        pendingKeys.push(key)
        return pipe
      }),
      exec: vi.fn(() => Promise.resolve(pendingKeys.map((k) => [null, store[k] ?? {}]))),
    }
    const pendingKeys: string[] = []
    const redis = { pipeline: vi.fn(() => { pendingKeys.length = 0; return pipe }) } as unknown as Redis
    const persister = new RulePersister(pool, redis)

    const snap: DeviceIo = { ignition: true, din1: false, unplug: null, alarm: false, fuelPct: null, fuelL: null, fuelBasePct: null, fuelBaseL: null }
    await persister.saveIoState(new Map([['42', snap]]))
    expect(store['rule:iostate:42']).toEqual({ ignition: '1', din1: '0', alarm: '0' }) // null unplug omitted

    const lookup = await persister.loadIoState([42n])
    expect(lookup(42n)).toEqual({ ignition: true, din1: false, unplug: null, alarm: false, fuelPct: null, fuelL: null, fuelBasePct: null, fuelBaseL: null })
    expect(lookup(99n)).toBeUndefined()

    // fuel level round-trips (a restart warm-starts the last fuel for fuel_theft drop detection)
    await persister.saveIoState(new Map([['7', { ignition: false, din1: null, unplug: null, alarm: null, fuelPct: 55, fuelL: 40.5, fuelBasePct: null, fuelBaseL: null }]]))
    expect(store['rule:iostate:7']).toMatchObject({ ignition: '0', fuelPct: '55', fuelL: '40.5' })
    expect((await persister.loadIoState([7n]))(7n)).toMatchObject({ fuelPct: 55, fuelL: 40.5, fuelBasePct: null, fuelBaseL: null })
  })
})
