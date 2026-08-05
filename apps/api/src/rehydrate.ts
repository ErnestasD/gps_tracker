import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'
import { ibuttonKeyFromHex } from '@orbetra/shared'

import { tenantDevicesKey } from './routes/deviceRegistry.js'
import { geofenceCacheEntry } from './routes/geofenceRegistry.js'

/**
 * Boot-time DB→Redis rehydrate (resolves the crud.ts follow-up). The pipeline resolves EVERY device
 * against `registry:imei` (+ `device:tenant`/`device:account`/`device:config`), and the worker
 * evaluates geofences / resolves iButton→driver against `geofence:tenant:*` / `driver:ibutton:*` —
 * all published incrementally by CRUD. If Redis is flushed/lost these are empty until each row is
 * next edited: an empty `registry:imei` QUARANTINES THE WHOLE FLEET (ingest rejects every unknown
 * IMEI) — audit D1. On API start we repopulate them from the durable DB so a deploy/restart is the
 * backfill. Idempotent (hset overwrites); best-effort per row.
 */
export async function rehydrateRegistries(redis: Redis, db: Db): Promise<{ devices: number; geofences: number; ibuttons: number }> {
  // one pipeline for all writes — a boot backfill over every tenant must not be N serial round-trips
  const pipe = redis.pipeline()
  // device registry (audit D1): reuse deviceRegistry.activateDevice's exact keys/shape so a rehydrate
  // and an incremental CRUD activate can never drift. profile presence_rules resolved once, in memory.
  const profileRules = new Map((await db.profiles.list()).map((p) => [p.id, p.presenceRules]))
  let devices = 0
  const registryRows = await db.devices.listAllForRegistry()
  // The per-tenant index is repaired ADDITIVELY here and reconciled member-by-member below — never
  // rebuilt wholesale. Two rejected designs and why:
  //
  //   DEL then SADD in place: `pipeline()` is command batching, not MULTI, and this process is
  //   already serving `/v1/devices/last`. Every tenant's index sits EMPTY for the duration
  //   (measured: 9 of 11 concurrent reads returned a blank map on a 2400-device rehydrate), and a
  //   connection blip partway through leaves them empty until the next successful boot.
  //
  //   Build a scratch key, then RENAME: atomic, but it still overwrites whatever landed on the live
  //   key while it ran. A rolling deploy rehydrates on one replica while the others serve CRUD, so
  //   a device activated mid-rehydrate silently loses its index entry until the NEXT restart.
  //
  // Additive + reconcile has neither window: a concurrent activate writes `device:tenant` and the
  // index in one MULTI, so the reconcile below sees the mapping and keeps the member. Correctness
  // never depended on this anyway — the read path re-verifies every member against `device:tenant`
  // (a stale entry costs a wasted lookup, never a leak); this is hygiene, and hygiene must not cost
  // availability.
  for (const d of registryRows) {
    const id = d.id.toString()
    pipe.hset('registry:imei', d.imei, id)
    pipe.hset('device:tenant', id, d.tenantId)
    pipe.hset('device:account', id, d.accountId)
    pipe.hset('device:config', id, JSON.stringify({ presenceRules: profileRules.get(d.profileId) ?? {}, odometerSource: d.odometerSource }))
    pipe.sadd(tenantDevicesKey(d.tenantId), id)
    devices++
  }
  let geofences = 0
  for (const g of await db.geofences.listAll()) {
    const [k, field, value] = geofenceCacheEntry(g) // same shape CRUD writes (no drift)
    pipe.hset(k, field, value)
    geofences++
  }
  let ibuttons = 0
  for (const d of await db.drivers.listAllIbuttons()) {
    // canonical decimal key (matches the pipeline's AVL-78 derivation), scoped by tenant AND account
    const key = ibuttonKeyFromHex(d.ibutton)
    if (key === null) continue // malformed hex (shouldn't persist, but never send null to hset)
    pipe.hset(`driver:ibutton:${d.tenantId}:${d.accountId}`, key, d.driverId)
    ibuttons++
  }
  const results = await pipe.exec()
  // ioredis returns per-command errors in the result array rather than throwing, so an unchecked
  // exec() swallows exactly the partial failures this rebuild is designed to survive. Report them:
  // a rehydrate that half-worked must not read as a successful one in the boot log.
  const failed = (results ?? []).filter(([err]) => err !== null).length
  if (failed > 0) console.error(`rehydrate: ${failed} of ${results?.length ?? 0} redis commands failed`)

  // Reconcile: drop index members whose `device:tenant` mapping is gone or points elsewhere. This
  // covers what the additive pass above cannot — a device retired while Redis was unreachable, and
  // a tenant that lost its LAST device (it has no row in `registryRows` at all, so nothing above
  // visits its key). Membership is judged per MEMBER against the authoritative hash written moments
  // ago, not against a snapshot taken before three DB reads and a keyspace scan, so a device
  // activated by another replica mid-sweep is kept: its `device:tenant` row is written in the same
  // MULTI as its index entry. SCAN is cursor-based and never blocks the server, unlike KEYS.
  const KEY_RE = /^tenant:(.+):devices$/
  let cursor = '0'
  let pruned = 0
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'tenant:*:devices*', 'COUNT', 500)
    cursor = next
    for (const key of keys) {
      // a scratch key from an older build that rebuilt via RENAME; nothing writes these now
      if (key.endsWith(':rebuild')) {
        await redis.del(key)
        continue
      }
      const m = KEY_RE.exec(key)
      if (m === null) continue
      const tenantId = m[1]!
      const members = await redis.smembers(key)
      if (members.length === 0) continue
      const owners = await redis.hmget('device:tenant', ...members)
      const gone = members.filter((_, i) => owners[i] !== tenantId)
      if (gone.length > 0) {
        await redis.srem(key, ...gone)
        pruned += gone.length
      }
      if (gone.length === members.length) await redis.del(key) // emptied: do not leave the key behind
    }
  } while (cursor !== '0')
  if (pruned > 0) console.log(`rehydrate: pruned ${pruned} stale device-index entries`)

  return { devices, geofences, ibuttons }
}
