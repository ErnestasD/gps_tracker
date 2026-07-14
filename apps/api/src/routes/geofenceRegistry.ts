import type { Redis } from 'ioredis'

import type { GeofenceView } from '@orbetra/shared'

/**
 * Geofence → Redis sync (E05-2). The worker evaluates geofence transitions in-memory
 * against cached geometries, so geofence CRUD publishes to `geofence:tenant:{tenantId}`
 * (hash: geofenceId → {accountId, name, geometry}). The worker loads a device's tenant
 * set and filters by account (null ⇒ tenant-shared). Keyed by tenant so a delete/update
 * is a single field op and the worker can load one tenant's fences at once.
 */
const key = (tenantId: string): string => `geofence:tenant:${tenantId}`

/** The canonical [hashKey, field, value] a geofence occupies in the worker's cache — the SINGLE
 *  source of the cache shape, shared by the incremental CRUD sync and the boot rehydrate (no drift). */
export function geofenceCacheEntry(g: GeofenceView): [string, string, string] {
  return [key(g.tenantId), g.id, JSON.stringify({ accountId: g.accountId, name: g.name, geometry: g.geometry })]
}

export async function syncGeofence(redis: Redis, g: GeofenceView): Promise<void> {
  const [k, field, value] = geofenceCacheEntry(g)
  await redis.hset(k, field, value)
}

export async function removeGeofence(redis: Redis, tenantId: string, id: string): Promise<void> {
  await redis.hdel(key(tenantId), id)
}
