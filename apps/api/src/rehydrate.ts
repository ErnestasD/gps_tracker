import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'
import { ibuttonKeyFromHex } from '@orbetra/shared'

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
  for (const d of await db.devices.listAllForRegistry()) {
    const id = d.id.toString()
    pipe.hset('registry:imei', d.imei, id)
    pipe.hset('device:tenant', id, d.tenantId)
    pipe.hset('device:account', id, d.accountId)
    pipe.hset('device:config', id, JSON.stringify({ presenceRules: profileRules.get(d.profileId) ?? {}, odometerSource: d.odometerSource }))
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
  await pipe.exec()
  return { devices, geofences, ibuttons }
}
