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

  /**
   * MAKE `registry:imei` MATCH THE DATABASE. One HGETALL, one fresh read, one authoritative pass.
   *
   * The additive rebuild above cannot be correct on its own, and the reason is not a race but the
   * shape of the query: it selects `retiredAt: null`, so it can only ever ADD mappings. It has no
   * way to express "this one should be gone". Three states survive it, and all three end with a
   * tracker whose data is accepted when it should not be:
   *
   *   * a device RETIRED between the snapshot and the pipeline exec is written back in full —
   *     mapping, tenant, account, config — and nothing removes it again, because the next rehydrate
   *     excludes retired rows rather than deleting their keys and the index reconcile below keeps
   *     the member (the stale `device:tenant` row we just wrote agrees with it). It ingests,
   *     publishes live positions and fires rules, permanently;
   *   * a mapping left behind by a teardown that half-failed (the eval landed, the MULTI did not)
   *     points at a device that no longer exists;
   *   * a mapping STOLEN by a snapshot replay — the restore walk writing `X → old id` after the
   *     IMEI was legitimately reclaimed by a new device — leaves the new device dark.
   *
   * A guard on the write cannot fix any of them. The first is a DELETED key, so "is it free?" is
   * satisfied and the resurrection is allowed; and a guard that refuses would break the self-heal
   * that `deviceImport` and `deactivateDevice` both explicitly promise ("created, not yet
   * reachable — the boot rehydrate repairs it"). The answer is not to make the writes cleverer, it
   * is to finish by comparing the whole hash against the truth. Doing it LAST also removes the
   * window entirely for anything the pipeline itself wrote.
   *
   * The read is deliberately fresh rather than reusing `registryRows`: retire tears Redis down
   * BEFORE the DB soft-delete commits, so a snapshot taken earlier cannot see a retire that is
   * already visible in Redis.
   */
  let imeiFixed = 0
  try {
    const [live, current] = await Promise.all([db.devices.listAllForRegistry(), redis.hgetall('registry:imei')])
    const shouldBe = new Map(live.map((d) => [d.imei, d.id.toString()]))
    const fix = redis.pipeline()
    for (const [imei, id] of Object.entries(current)) {
      const want = shouldBe.get(imei)
      if (want === id) continue
      if (want === undefined) {
        // no ACTIVE device claims this IMEI: a resurrected retire, or a ghost from a failed
        // teardown. Either way ingest must stop accepting it.
        fix.hdel('registry:imei', imei)
      } else {
        // an active device DOES claim it, and Redis names a different one — a stolen mapping. The
        // partial unique index on active rows makes the DB the only possible authority here.
        fix.hset('registry:imei', imei, want)
      }
      imeiFixed++
    }
    // …and anything the pipeline failed to write at all
    for (const [imei, id] of shouldBe) {
      if (current[imei] === undefined) {
        fix.hset('registry:imei', imei, id)
        imeiFixed++
      }
    }
    if (imeiFixed > 0) {
      await fix.exec()
      console.warn(`rehydrate: reconciled ${imeiFixed} imei mapping(s) against the database`)
    }
  } catch (err) {
    // NON-FATAL, and deliberately so: every registry write above has already landed, and throwing
    // here would skip the index sweep below — leaving an operator unable to tell "the fleet was
    // never repopulated" from "everything repopulated, reconciliation stopped". Same reasoning as
    // the sweep's own catch.
    console.error('rehydrate: imei reconciliation failed', err instanceof Error ? err.message : String(err))
  }

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
      try {
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
      } catch (err) {
        // One bad key (a WRONGTYPE, a blip) must not abort the sweep — and must not propagate:
        // every registry write above has already landed, so a throw here made the boot log say
        // "rehydrate failed" and swallow the device count, leaving an operator unable to tell
        // "the fleet was never repopulated" from "everything repopulated, pruning stopped".
        console.error(`rehydrate: skipped ${key} during the index sweep`, err)
      }
      // NO `del(key)` when everything snapshotted was stale: that would wipe a member another
      // replica added between the SMEMBERS and here — the exact race this whole design avoids.
      // Redis drops a set when its last member is SREM'd, so there is nothing left to clean up.
    }
  } while (cursor !== '0')
  if (pruned > 0) console.log(`rehydrate: pruned ${pruned} stale device-index entries`)

  return { devices, geofences, ibuttons }
}
