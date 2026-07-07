import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Redis } from 'ioredis'

/**
 * Dev/e2e seed (E02-6): registers N fleet devices in the Redis registries the
 * pipeline reads — `registry:imei` (imei → deviceId, checked by ingest handshake)
 * and `device:tenant` (deviceId → tenantId, read by LiveState before publishing).
 * TEMPORARY tooling until E03-3 device CRUD owns these hashes (then this script
 * seeds via the API instead). deviceId convention: the numeric IMEI itself —
 * deviceId is a bigint through the whole pipeline (rawStreamPayloadSchema /
 * NormalizedRecord), so it MUST be numeric; proven live: `dev-<imei>` made
 * ingest throw "Cannot convert dev-… to a BigInt" and close every session.
 *
 * Usage: pnpm sim:seed -- --devices 500 [--imei 356307042441013] [--tenant stub-tenant]
 *        [--account <id>] [--redis-url redis://127.0.0.1:6379]
 */

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1]!
  return fallback
}

export interface SeedEntry {
  imei: string
  deviceId: string
}

/** Same imei derivation as planFleet (fleet.ts): device i = base+i. */
export function seedEntries(baseImei: string, devices: number): SeedEntry[] {
  const base = BigInt(baseImei)
  return Array.from({ length: devices }, (_, i) => {
    const imei = (base + BigInt(i)).toString()
    return { imei, deviceId: imei }
  })
}

async function main(): Promise<void> {
  const devices = Number(arg('devices', '1'))
  if (!Number.isInteger(devices) || devices < 1) {
    // review MED: 0/NaN crashed the summary log, negative threw at Array.from
    console.error(`--devices must be a positive integer, got '${arg('devices', '1')}'`)
    process.exit(2)
  }
  const baseImei = arg('imei', '356307042441013')
  const tenant = arg('tenant', 'stub-tenant')
  const account = arg('account', '')
  const redis = new Redis(arg('redis-url', 'redis://127.0.0.1:6379'))

  const entries = seedEntries(baseImei, devices)
  const pipeline = redis.pipeline()
  for (const { imei, deviceId } of entries) {
    pipeline.hset('registry:imei', imei, deviceId)
    pipeline.hset('device:tenant', deviceId, tenant)
    if (account !== '') pipeline.hset('device:account', deviceId, account)
  }
  await pipeline.exec()
  await redis.quit()
  console.log(
    `seeded ${entries.length} device(s): imei ${entries[0]!.imei}..${entries[entries.length - 1]!.imei} → tenant=${tenant}${account ? ` account=${account}` : ''}`,
  )
}

// entrypoint guard: file doubles as a module (seedEntries is unit-tested);
// full-path comparison (review LOW: basename endsWith was fragile)
const isEntrypoint = (): boolean => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
  } catch {
    return false
  }
}
if (isEntrypoint()) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
