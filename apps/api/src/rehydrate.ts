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
  // The per-tenant index is REBUILT, not merely added to. Everything else here is an hset, which
  // self-heals by overwriting; a set only grows, so a member stranded by a partial teardown would
  // survive every restart forever and keep a retired device on the map. Boot is the one moment we
  // hold the authoritative list, so it is the one place a true repair is possible.
  //
  // Built into a SCRATCH key and swapped with RENAME, never DEL-then-SADD in place. `pipeline()` is
  // command batching, not MULTI, and this process is already serving `/v1/devices/last` while it
  // runs: a DEL-first rebuild leaves every tenant's index empty for the duration (measured: 9 of 11
  // concurrent reads returned an empty map on a 2400-device rehydrate), and a connection blip
  // partway through leaves them empty PERMANENTLY, until the next successful boot. RENAME is
  // atomic and the live key is never absent, so a partial failure simply keeps the old contents.
  const scratch = (tenantId: string): string => `${tenantDevicesKey(tenantId)}:rebuild`
  const tenantIds = new Set(registryRows.map((d) => d.tenantId))
  for (const tenantId of tenantIds) pipe.del(scratch(tenantId))
  for (const d of registryRows) {
    const id = d.id.toString()
    pipe.hset('registry:imei', d.imei, id)
    pipe.hset('device:tenant', id, d.tenantId)
    pipe.hset('device:account', id, d.accountId)
    pipe.hset('device:config', id, JSON.stringify({ presenceRules: profileRules.get(d.profileId) ?? {}, odometerSource: d.odometerSource }))
    pipe.sadd(scratch(d.tenantId), id)
    devices++
  }
  for (const tenantId of tenantIds) pipe.rename(scratch(tenantId), tenantDevicesKey(tenantId))
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

  // Tenants that lost their LAST device do not appear in `registryRows` at all, so the rebuild
  // above never touches them and a stranded member would outlive every restart — the exact case the
  // rebuild exists for. One SCAN closes it, and sweeps any scratch key a crashed run left behind
  // (the RENAMEs above consumed this run's, so a survivor is by definition stale). SCAN is
  // cursor-based and never blocks the server, unlike KEYS.
  const KEY_RE = /^tenant:(.+):devices(:rebuild)?$/
  let cursor = '0'
  const stale: string[] = []
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'tenant:*:devices*', 'COUNT', 500)
    cursor = next
    for (const k of keys) {
      const m = KEY_RE.exec(k)
      if (m === null) continue
      if (m[2] !== undefined || !tenantIds.has(m[1]!)) stale.push(k)
    }
  } while (cursor !== '0')
  if (stale.length > 0) await redis.del(...stale)

  return { devices, geofences, ibuttons }
}
