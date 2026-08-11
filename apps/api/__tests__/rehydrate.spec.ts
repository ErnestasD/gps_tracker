import type { Redis } from 'ioredis'
import { describe, expect, it } from 'vitest'

import type { Db } from '@orbetra/db'
import { ibuttonKeyFromHex } from '@orbetra/shared'

import { tenantDevicesKey } from '../src/routes/deviceRegistry.js'
import { rehydrateRegistries } from '../src/rehydrate.js'

/**
 * Boot DB→Redis rehydrate. Proves the geofence cache + iButton map are repopulated from the DB with
 * the SAME keys CRUD publishes — so a Redis flush + API restart backfills both (geofences fire again,
 * taps resolve again). Uses fakes (no container): a fake db returns rows, a fake redis records hsets.
 */
const T = '11111111-1111-1111-1111-111111111111'
const A = '22222222-2222-2222-2222-222222222222'

function fakeRedis(store: Map<string, Record<string, string>>, sets = new Map<string, Set<string>>()): Redis {
  const set = (k: string, f: string, v: string) => { const h = store.get(k) ?? {}; h[f] = v; store.set(k, h) }
  const sadd = (k: string, m: string) => { const s = sets.get(k) ?? new Set<string>(); s.add(m); sets.set(k, s) }
  const del = (...ks: string[]) => { for (const k of ks) { sets.delete(k); store.delete(k) } }

  return {
    hset: (k: string, f: string, v: string) => { set(k, f, v); return Promise.resolve(1) },
    del: (...ks: string[]) => { del(...ks); return Promise.resolve(ks.length) },
    smembers: (k: string) => Promise.resolve([...(sets.get(k) ?? [])]),
    // real Redis drops a set once its last member is removed — which is why the reconcile does NOT
    // DEL the key itself (that would wipe a member another replica added mid-sweep)
    srem: (k: string, ...ms: string[]) => {
      const t = sets.get(k)
      for (const m of ms) t?.delete(m)
      if (t !== undefined && t.size === 0) sets.delete(k)
      return Promise.resolve(ms.length)
    },
    hmget: (k: string, ...fs: string[]) => Promise.resolve(fs.map((f) => store.get(k)?.[f] ?? null)),
    hgetall: (k: string) => Promise.resolve({ ...(store.get(k) ?? {}) }),
    // one page, then the terminating cursor — enough to exercise the orphan sweep
    scan: (cursor: string) =>
      Promise.resolve(cursor === '0' ? ['0', [...sets.keys()].filter((k) => /^tenant:.+:devices/.test(k))] : ['0', []]),
    // rehydrate uses a pipeline: a chainable hset/sadd + exec
    pipeline: () => {
      const chain = {
        hset: (k: string, f: string, v: string) => { set(k, f, v); return chain },
        hdel: (k: string, f: string) => { const h = store.get(k); delete h?.[f]; return chain },
        sadd: (k: string, m: string) => { sadd(k, m); return chain },
        del: (k: string) => { del(k); return chain },
        exec: () => Promise.resolve([]),
      }
      return chain
    },
  } as unknown as Redis
}

type FakeDevice = { id: bigint; imei: string; tenantId: string; accountId: string; profileId: string; odometerSource: string }
function fakeDb(
  geofences: unknown[],
  ibuttons: { tenantId: string; accountId: string; ibutton: string; driverId: string }[],
  devices: FakeDevice[] = [],
  profiles: { id: string; presenceRules: unknown }[] = [],
): Db {
  return {
    devices: { listAllForRegistry: () => Promise.resolve(devices) },
    profiles: { list: () => Promise.resolve(profiles) },
    geofences: { listAll: () => Promise.resolve(geofences) },
    drivers: { listAllIbuttons: () => Promise.resolve(ibuttons) },
  } as unknown as Db
}

describe('rehydrateRegistries', () => {
  it('repopulates the geofence cache and the iButton map with canonical keys', async () => {
    const store = new Map<string, Record<string, string>>()
    const gf = { id: 'gf-1', tenantId: T, accountId: A, name: 'Depot', color: '#fff', kind: 'polygon', geometry: { type: 'Polygon', coordinates: [] }, createdAt: '2026-01-01T00:00:00Z' }
    const db = fakeDb([gf], [{ tenantId: T, accountId: A, ibutton: 'a1b2c3d4', driverId: 'drv-1' }])
    const res = await rehydrateRegistries(fakeRedis(store), db)

    expect(res).toEqual({ devices: 0, geofences: 1, ibuttons: 1 })
    // geofence published under geofence:tenant:{t} keyed by geofence id (matches syncGeofence / worker cache)
    expect(store.get(`geofence:tenant:${T}`)?.['gf-1']).toContain('Depot')
    // iButton map keyed by tenant AND account, field = the CANONICAL decimal (not the raw hex)
    const map = store.get(`driver:ibutton:${T}:${A}`)!
    expect(map[ibuttonKeyFromHex('a1b2c3d4')!]).toBe('drv-1')
    expect(map['a1b2c3d4']).toBeUndefined() // never the raw hex
  })

  it('skips a driver whose iButton is not valid hex (never hsets a null field)', async () => {
    const store = new Map<string, Record<string, string>>()
    const db = fakeDb([], [{ tenantId: T, accountId: A, ibutton: 'not-hex!!', driverId: 'drv-x' }])
    const res = await rehydrateRegistries(fakeRedis(store), db)
    expect(res.ibuttons).toBe(0)
    expect(store.size).toBe(0)
  })

  it('rebuilds the DEVICE registry (audit D1) — registry:imei + device:tenant/account/config', async () => {
    const store = new Map<string, Record<string, string>>()
    const dev: FakeDevice = { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'prof-1', odometerSource: 'gps' }
    const db = fakeDb([], [], [dev], [{ id: 'prof-1', presenceRules: { minStopS: 120 } }])
    const res = await rehydrateRegistries(fakeRedis(store), db)

    expect(res.devices).toBe(1)
    expect(store.get('registry:imei')?.['356307042440000']).toBe('42') // ingest resolves the fleet again
    expect(store.get('device:tenant')?.['42']).toBe(T)
    expect(store.get('device:account')?.['42']).toBe(A)
    expect(JSON.parse(store.get('device:config')?.['42'] ?? '{}')).toEqual({ presenceRules: { minStopS: 120 }, odometerSource: 'gps' })
  })

  it('removes a mapping for a device RETIRED mid-rehydrate instead of resurrecting it forever', async () => {
    /**
     * The additive rebuild selects `retiredAt: null`, so it can only ADD — it has no way to express
     * "this one should be gone". A retire landing between the snapshot and the pipeline exec is
     * therefore written back in full and never removed again: the next rehydrate excludes retired
     * rows rather than deleting their keys, and the index reconcile keeps the member because the
     * stale `device:tenant` row it just wrote agrees with it. The device ingests forever.
     *
     * A guard on the write cannot catch this one — the retire DELETED the mapping, so "is it free?"
     * is satisfied. Only comparing the finished hash against the database can.
     */
    const store = new Map<string, Record<string, string>>()
    const dev: FakeDevice = { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'prof-1', odometerSource: 'gps' }
    const db = fakeDb([], [], [dev], [{ id: 'prof-1', presenceRules: {} }])
    let reads = 0
    db.devices.listAllForRegistry = () => {
      reads++
      return Promise.resolve(reads === 1 ? [dev] : []) // retired between the two reads
    }

    await rehydrateRegistries(fakeRedis(store), db)

    expect(reads).toBe(2)
    expect(store.get('registry:imei')?.['356307042440000']).toBeUndefined() // ingest refuses it again
  })

  it('restores a mapping STOLEN by a snapshot replay, rather than leaving the new device dark', async () => {
    // the restore walk writing `X → old id` after the IMEI was legitimately reclaimed. The database
    // is the only possible authority: the partial unique index on active rows means exactly one
    // live device can hold an IMEI.
    const store = new Map<string, Record<string, string>>([['registry:imei', { '356307042440000': '42' }]])
    const dev: FakeDevice = { id: 77n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'prof-1', odometerSource: 'gps' }
    await rehydrateRegistries(fakeRedis(store), fakeDb([], [], [dev], [{ id: 'prof-1', presenceRules: {} }]))
    expect(store.get('registry:imei')?.['356307042440000']).toBe('77')
  })

  it('deletes a GHOST left by a teardown that half-failed', async () => {
    // the eval landed, the MULTI did not — a mapping pointing at a device no active row claims
    const store = new Map<string, Record<string, string>>([['registry:imei', { '999999999999999': '13' }]])
    await rehydrateRegistries(fakeRedis(store), fakeDb([], [], [], []))
    expect(store.get('registry:imei')?.['999999999999999']).toBeUndefined()
  })

  it('leaves a correct mapping alone — the common case must not churn Redis', async () => {
    const store = new Map<string, Record<string, string>>()
    const dev: FakeDevice = { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'prof-1', odometerSource: 'gps' }
    await rehydrateRegistries(fakeRedis(store), fakeDb([], [], [dev], [{ id: 'prof-1', presenceRules: {} }]))
    expect(store.get('registry:imei')?.['356307042440000']).toBe('42')
  })

  it('rebuilds the per-tenant device INDEX too — else /v1/devices/last is empty after a Redis flush', async () => {
    // The index is what makes the snapshot O(caller) instead of O(platform). It is derived state
    // with no other writer on this path, so if the boot backfill forgets it the map silently shows
    // nothing until each device is next EDITED — the same class of failure as audit D1 itself.
    const store = new Map<string, Record<string, string>>()
    const sets = new Map<string, Set<string>>()
    const devs: FakeDevice[] = [
      { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'p', odometerSource: 'gps' },
      { id: 43n, imei: '356307042440001', tenantId: T, accountId: A, profileId: 'p', odometerSource: 'gps' },
      { id: 99n, imei: '356307042440002', tenantId: 'other-tenant', accountId: A, profileId: 'p', odometerSource: 'gps' },
    ]
    await rehydrateRegistries(fakeRedis(store, sets), fakeDb([], [], devs, [{ id: 'p', presenceRules: {} }]))

    expect([...(sets.get(tenantDevicesKey(T)) ?? [])].sort()).toEqual(['42', '43'])
    expect([...(sets.get(tenantDevicesKey('other-tenant')) ?? [])]).toEqual(['99'])
  })

  it('REBUILDS the device index rather than adding to it — boot is the only place drift can be repaired', async () => {
    // Every other key here is an hset, which self-heals by overwriting. A set only grows: a member
    // stranded by a partially-applied teardown would survive every restart and keep a retired
    // device on the map forever. Boot holds the authoritative list, so boot prunes.
    const store = new Map<string, Record<string, string>>()
    const sets = new Map<string, Set<string>>([[tenantDevicesKey(T), new Set(['42', 'ghost-1', 'ghost-2'])]])
    const dev: FakeDevice = { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'p', odometerSource: 'gps' }
    await rehydrateRegistries(fakeRedis(store, sets), fakeDb([], [], [dev], [{ id: 'p', presenceRules: {} }]))
    expect([...(sets.get(tenantDevicesKey(T)) ?? [])]).toEqual(['42'])
  })

  it('never leaves a live index EMPTY while repairing it', async () => {
    // `pipeline()` is command batching, not MULTI, and the API is already serving /v1/devices/last
    // while this runs. A DEL-then-SADD rebuild blanks every tenant's map for the duration, and a
    // connection blip partway through blanks them until the NEXT successful boot. Repairing
    // additively and then pruning stale MEMBERS means the key is never absent and never empty.
    const store = new Map<string, Record<string, string>>()
    const sets = new Map<string, Set<string>>([[tenantDevicesKey(T), new Set(['old'])]])
    const seen: (string | undefined)[] = []
    const dev: FakeDevice = { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'p', odometerSource: 'gps' }
    const redis = fakeRedis(store, sets)
    // observe the live key after every pipelined command — it must never be missing or empty
    const observing = new Proxy(redis, {
      get(t, prop, r): unknown {
        const v: unknown = Reflect.get(t, prop, r)
        if (prop !== 'pipeline') return v
        return (): unknown => {
          const chain = (v as () => Record<string, unknown>)()
          return new Proxy(chain, {
            get(ct, cp, cr): unknown {
              const cv: unknown = Reflect.get(ct, cp, cr)
              if (typeof cv !== 'function') return cv
              return (...a: unknown[]): unknown => {
                const out: unknown = (cv as (...x: unknown[]) => unknown).apply(ct, a)
                seen.push(sets.has(tenantDevicesKey(T)) ? [...sets.get(tenantDevicesKey(T))!].join(',') : undefined)
                return out === chain ? cr : out
              }
            },
          })
        }
      },
    })
    await rehydrateRegistries(observing, fakeDb([], [], [dev], [{ id: 'p', presenceRules: {} }]))
    expect(seen.every((v) => v !== undefined && v !== '')).toBe(true)
    expect([...(sets.get(tenantDevicesKey(T)) ?? [])]).toEqual(['42'])
  })

  it('never DELs an index key: a member added mid-sweep survives even when every OLD member is stale', async () => {
    // The reconcile deletes stale MEMBERS, never the key. Deleting a key whose snapshotted members
    // were all stale would wipe whatever a concurrent activate wrote in between — reopening the
    // exact race the additive design exists to close. Redis drops an emptied set by itself.
    const store = new Map<string, Record<string, string>>([['device:tenant', { '123': 'tenant-a' }]])
    const sets = new Map<string, Set<string>>([[tenantDevicesKey('tenant-a'), new Set(['999', '123'])]])
    const dev: FakeDevice = { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'p', odometerSource: 'gps' }
    await rehydrateRegistries(fakeRedis(store, sets), fakeDb([], [], [dev], [{ id: 'p', presenceRules: {} }]))
    expect([...(sets.get(tenantDevicesKey('tenant-a')) ?? [])]).toEqual(['123'])
  })

  it('keeps a device another replica activated MID-rehydrate — the sweep judges members, not a snapshot', async () => {
    // REGRESSION. A rolling deploy rehydrates on one replica while the others serve CRUD. Deciding
    // "orphan" from the tenant list snapshotted before three DB reads and a keyspace scan wiped the
    // index of any tenant that gained its first device in between: `device:tenant` said the device
    // was registered, the index said the tenant had nothing, and its map stayed blank until the
    // NEXT boot. Membership is now judged per member against the authoritative hash.
    const store = new Map<string, Record<string, string>>([['device:tenant', { '77': 'brand-new-tenant' }]])
    const sets = new Map<string, Set<string>>([[tenantDevicesKey('brand-new-tenant'), new Set(['77'])]])
    const dev: FakeDevice = { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'p', odometerSource: 'gps' }
    await rehydrateRegistries(fakeRedis(store, sets), fakeDb([], [], [dev], [{ id: 'p', presenceRules: {} }]))
    expect([...(sets.get(tenantDevicesKey('brand-new-tenant')) ?? [])]).toEqual(['77'])
  })

  it('sweeps the index of a tenant whose LAST device is gone, and any scratch key an older build left', async () => {
    // Such a tenant has no row in listAllForRegistry at all, so the rebuild never visits it — the
    // one place a stranded member could still outlive every restart.
    const store = new Map<string, Record<string, string>>()
    const sets = new Map<string, Set<string>>([
      [tenantDevicesKey('emptied-tenant'), new Set(['99'])],
      [`${tenantDevicesKey('older-build')}:rebuild`, new Set(['1', '2'])],
    ])
    const dev: FakeDevice = { id: 42n, imei: '356307042440000', tenantId: T, accountId: A, profileId: 'p', odometerSource: 'gps' }
    await rehydrateRegistries(fakeRedis(store, sets), fakeDb([], [], [dev], [{ id: 'p', presenceRules: {} }]))
    expect(sets.has(tenantDevicesKey('emptied-tenant'))).toBe(false)
    expect(sets.has(`${tenantDevicesKey('older-build')}:rebuild`)).toBe(false)
    expect([...(sets.get(tenantDevicesKey(T)) ?? [])]).toEqual(['42']) // the live one is untouched
  })
})
