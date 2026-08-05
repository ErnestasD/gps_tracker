import type { Redis } from 'ioredis'

import { tenantDevicesKey } from '@orbetra/shared'

/**
 * Redis registry sync (E03-3) — the bridge between device CRUD and the raw pipeline.
 * ingest reads `registry:imei` (imei→deviceId) on handshake; worker LiveState reads
 * `device:tenant` + `device:account` before publishing. A created device is invisible
 * to the pipeline until activate() runs; a retired one is rejected once deactivate()
 * runs (AC[2]). Lives in the API layer, NOT packages/db (that stays pure DB).
 */

// Per-tenant device index (audit MED): `device:tenant` answers "whose is this one?" but forces a
// platform-wide HGETALL to answer "which are mine?". The key builder lives in @orbetra/shared
// because the simulator/e2e seed writes it too and cannot import from the API.
export { tenantDevicesKey } from '@orbetra/shared'

export interface RegistryDevice {
  id: bigint
  imei: string
  tenantId: string
  accountId: string
  /** Trip config for the worker (E04-5): the device's profile presence_rules +
   * odometerSource. Absent ⇒ the worker's trip engine uses defaults. */
  config?: { presenceRules: unknown; odometerSource: string }
}

export async function activateDevice(redis: Redis, d: RegistryDevice): Promise<void> {
  const id = d.id.toString()
  // If this device was previously registered to a DIFFERENT tenant, drop it from that tenant's
  // index — otherwise the old owner keeps a member pointing at a device it no longer owns. Read
  // first, outside the MULTI: a CRUD write, not a hot path.
  const prevTenant = await redis.hget('device:tenant', id)
  const m = redis
    .multi()
    .hset('registry:imei', d.imei, id)
    .hset('device:tenant', id, d.tenantId)
    .hset('device:account', id, d.accountId)
    .sadd(tenantDevicesKey(d.tenantId), id)
  if (prevTenant !== null && prevTenant !== d.tenantId) m.srem(tenantDevicesKey(prevTenant), id)
  if (d.config !== undefined) {
    m.hset('device:config', id, JSON.stringify({ presenceRules: d.config.presenceRules ?? {}, odometerSource: d.config.odometerSource }))
  }
  await m.exec()
}

/** Update ONLY the worker trip config for a device (E04-5) — used when a PATCH changes
 * odometerSource or profile without re-activating the whole registry entry. */
export async function syncDeviceConfig(redis: Redis, id: bigint, presenceRules: unknown, odometerSource: string): Promise<void> {
  await redis.hset('device:config', id.toString(), JSON.stringify({ presenceRules: presenceRules ?? {}, odometerSource }))
}

/**
 * Remove `registry:imei[imei]` ONLY when it still points at this device.
 *
 * A blind HDEL is keyed on the IMEI, not on who owns it — and since retiring frees an IMEI, a repeat
 * DELETE on an already-retired device would tear down the mapping of the LIVE device that reclaimed
 * it (audit review HIGH). That device stays `retiredAt = NULL` and looks active in the UI while
 * ingest answers its handshake with 0x00, quarantines it, and after a few rejects closes the socket
 * on sight: no positions, no trips, no alerts, and nothing to distinguish it from a device that
 * simply went offline. Only an API restart repairs it, because the boot rehydrate is the sole other
 * writer of that key.
 */
const HDEL_IF_MINE = `if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then return redis.call('HDEL', KEYS[1], ARGV[1]) end
return 0`

export async function deactivateDevice(redis: Redis, d: { id: bigint; imei: string; tenantId: string }): Promise<void> {
  const id = d.id.toString()
  // The index entry is keyed by tenant, and the caller ALWAYS knows the tenant — it just read the
  // device row through a scoped repo. Deriving it from `device:tenant` instead would skip the SREM
  // whenever that hash row was already gone (a partially-applied earlier teardown, a Redis flush
  // before a rehydrate), stranding the member permanently: the index only ever grows, and nothing
  // else prunes it.
  await redis.eval(HDEL_IF_MINE, 1, 'registry:imei', d.imei, id)
  await redis
    .multi()
    .hdel('device:tenant', id)
    .hdel('device:account', id)
    .hdel('device:config', id)
    .del(`device:${id}:last`)
    .srem(tenantDevicesKey(d.tenantId), id)
    .exec()
}
