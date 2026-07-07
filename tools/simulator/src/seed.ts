import { Redis } from 'ioredis'

/**
 * Dev/e2e seed (E02-6): registers N fleet devices in the Redis registries the
 * pipeline reads — `registry:imei` (imei → deviceId, checked by ingest handshake)
 * and `device:tenant` (deviceId → tenantId, read by LiveState before publishing).
 * TEMPORARY tooling until E03-3 device CRUD owns these hashes (then this script
 * seeds via the API instead). deviceId convention: `dev-<imei>` — collision-free
 * and self-describing in Redis inspection.
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
    return { imei, deviceId: `dev-${imei}` }
  })
}

async function main(): Promise<void> {
  const devices = Number(arg('devices', '1'))
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

// import.meta guard: file doubles as a module (seedEntries is unit-tested)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
