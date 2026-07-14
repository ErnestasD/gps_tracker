import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'
import { ibuttonKeyFromHex } from '@orbetra/shared'

import { syncGeofence } from './routes/geofenceRegistry.js'

/**
 * Boot-time DB→Redis rehydrate (resolves the crud.ts follow-up). The worker evaluates geofences and
 * resolves iButton→driver against Redis caches (`geofence:tenant:*`, `driver:ibutton:*`) that CRUD
 * publishes incrementally. If Redis is flushed/lost, those caches are empty until each row is next
 * edited — geofences stop firing and taps stop resolving. On API start we repopulate them from the
 * durable DB so a deploy/restart is the backfill. Idempotent (hset overwrites); best-effort per row.
 */
export async function rehydrateRegistries(redis: Redis, db: Db): Promise<{ geofences: number; ibuttons: number }> {
  let geofences = 0
  for (const g of await db.geofences.listAll()) {
    await syncGeofence(redis, g)
    geofences++
  }
  let ibuttons = 0
  for (const d of await db.drivers.listAllIbuttons()) {
    // canonical decimal key (matches the pipeline's AVL-78 derivation), scoped by tenant AND account
    const key = ibuttonKeyFromHex(d.ibutton)
    if (key === null) continue // malformed hex (shouldn't persist, but never send null to hset)
    await redis.hset(`driver:ibutton:${d.tenantId}:${d.accountId}`, key, d.driverId)
    ibuttons++
  }
  return { geofences, ibuttons }
}
