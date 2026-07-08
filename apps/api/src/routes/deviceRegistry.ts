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
}

export async function activateDevice(redis: Redis, d: RegistryDevice): Promise<void> {
  const id = d.id.toString()
  await redis
    .multi()
    .hset('registry:imei', d.imei, id)
    .hset('device:tenant', id, d.tenantId)
    .hset('device:account', id, d.accountId)
    .exec()
}

export async function deactivateDevice(redis: Redis, d: { id: bigint; imei: string }): Promise<void> {
  const id = d.id.toString()
  await redis
    .multi()
    .hdel('registry:imei', d.imei)
    .hdel('device:tenant', id)
    .hdel('device:account', id)
    .del(`device:${id}:last`)
    .exec()
}
