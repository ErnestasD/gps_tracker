import type { Redis } from 'ioredis'

import { ibuttonKeyFromHex } from '@orbetra/shared'

/**
 * Driver iButton → Redis sync (V2, Part B). The worker's trip persister resolves a trip's iButton
 * (AVL 78) to a driver at close, so driver CRUD publishes to `driver:ibutton:{tenantId}:{accountId}`
 * (hash: canonical iButton key → driverId). Keyed by tenant AND ACCOUNT so a tap only resolves to a
 * driver in the TRIP's own account — the same account boundary the manual-assign path enforces
 * (#60 review). The field is the CANONICAL decimal form (ibuttonKeyFromHex) so it matches the
 * decimal the pipeline derives from AVL 78, regardless of hex case / leading zeros.
 */
const key = (tenantId: string, accountId: string): string => `driver:ibutton:${tenantId}:${accountId}`

/** Publish a driver's iButton mapping; if its iButton changed, drop the stale field first. */
export async function syncDriverIbutton(redis: Redis, tenantId: string, accountId: string, driverId: string, ibutton: string | null, oldIbutton: string | null): Promise<void> {
  const oldKey = oldIbutton !== null ? ibuttonKeyFromHex(oldIbutton) : null
  const newKey = ibutton !== null ? ibuttonKeyFromHex(ibutton) : null
  if (oldKey !== null && oldKey !== newKey) await redis.hdel(key(tenantId, accountId), oldKey)
  if (newKey !== null) await redis.hset(key(tenantId, accountId), newKey, driverId)
}

/** Drop a driver's iButton mapping (on delete). */
export async function removeDriverIbutton(redis: Redis, tenantId: string, accountId: string, ibutton: string | null): Promise<void> {
  const k = ibutton !== null ? ibuttonKeyFromHex(ibutton) : null
  if (k !== null) await redis.hdel(key(tenantId, accountId), k)
}
