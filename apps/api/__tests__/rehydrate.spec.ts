import type { Redis } from 'ioredis'
import { describe, expect, it } from 'vitest'

import type { Db } from '@orbetra/db'
import { ibuttonKeyFromHex } from '@orbetra/shared'

import { rehydrateRegistries } from '../src/rehydrate.js'

/**
 * Boot DB→Redis rehydrate. Proves the geofence cache + iButton map are repopulated from the DB with
 * the SAME keys CRUD publishes — so a Redis flush + API restart backfills both (geofences fire again,
 * taps resolve again). Uses fakes (no container): a fake db returns rows, a fake redis records hsets.
 */
const T = '11111111-1111-1111-1111-111111111111'
const A = '22222222-2222-2222-2222-222222222222'

function fakeRedis(store: Map<string, Record<string, string>>): Redis {
  const set = (k: string, f: string, v: string) => { const h = store.get(k) ?? {}; h[f] = v; store.set(k, h) }
  return {
    hset: (k: string, f: string, v: string) => { set(k, f, v); return Promise.resolve(1) },
    // rehydrate uses a pipeline: a chainable hset + exec
    pipeline: () => {
      const chain = { hset: (k: string, f: string, v: string) => { set(k, f, v); return chain }, exec: () => Promise.resolve([]) }
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
})
