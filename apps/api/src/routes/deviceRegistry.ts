import type { Redis } from 'ioredis'

/**
 * Redis registry sync (E03-3) — the bridge between device CRUD and the raw pipeline.
 * ingest reads `registry:imei` (imei→deviceId) on handshake; worker LiveState reads
 * `device:tenant` + `device:account` before publishing. A created device is invisible
 * to the pipeline until activate() runs; a retired one is rejected once deactivate()
 * runs (AC[2]). Lives in the API layer, NOT packages/db (that stays pure DB).
 */

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
  const m = redis
    .multi()
    .hset('registry:imei', d.imei, id)
    .hset('device:tenant', id, d.tenantId)
    .hset('device:account', id, d.accountId)
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

export async function deactivateDevice(redis: Redis, d: { id: bigint; imei: string }): Promise<void> {
  const id = d.id.toString()
  await redis
    .multi()
    .hdel('registry:imei', d.imei)
    .hdel('device:tenant', id)
    .hdel('device:account', id)
    .hdel('device:config', id)
    .del(`device:${id}:last`)
    .exec()
}
