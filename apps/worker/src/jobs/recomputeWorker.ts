import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { deviceTripConfig } from '../trip/config.js'
import type { DeviceTripConfig } from '../trip/engine.js'
import { recomputeTrips, type RecomputeScope } from '../trip/recompute.js'
import { TRIP_RECOMPUTE_QUEUE, type RecomputeJob } from './queue.js'

/** Read a device's trip config from the registry (device:config); undefined ⇒ engine default. */
async function resolveConfig(redis: Redis, deviceId: string): Promise<DeviceTripConfig | undefined> {
  const raw = await redis.hget('device:config', deviceId)
  if (raw === null) return undefined
  try {
    const j = JSON.parse(raw) as { presenceRules?: unknown; odometerSource?: unknown }
    return deviceTripConfig(j.presenceRules as Record<string, unknown> | null | undefined, j.odometerSource)
  } catch {
    return undefined
  }
}

export interface RecomputeWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  /** registry connection (device:tenant/device:account) for first-computation scope. */
  redis: Redis
  onDone?: (r: { deleted: number; created: number }) => void
}

/**
 * Resolve the tenant/account for a device's trips. Prefer the EXISTING trip covering the
 * recompute window (oldest, deterministic) so historical trips stay with the tenant that
 * owned the device when they happened — a re-claim to another tenant must not silently
 * move old trips. Fall back to the live registry only for a device's first-ever
 * computation.
 *
 * KNOWN LIMITATION (E04-2): a device re-claimed to a NEW tenant that has NO prior trip row
 * would attribute recomputed history to the new tenant (we have no per-position ownership
 * history in v1). Acceptable for v1 (re-claim of an actively-driven device is rare and
 * quarantine/claim is platform-admin gated); a full fix needs device-ownership intervals.
 */
export async function resolveTripScope(pool: Pool, redis: Redis, deviceId: string): Promise<RecomputeScope | null> {
  const existing = await pool.query('SELECT "tenantId","accountId" FROM trips WHERE "deviceId"=$1 ORDER BY "startTime" ASC LIMIT 1', [deviceId])
  if (existing.rows[0]) {
    const row = existing.rows[0] as { tenantId: string; accountId: string }
    return { tenantId: row.tenantId, accountId: row.accountId }
  }
  const [tenantId, accountId] = await Promise.all([redis.hget('device:tenant', deviceId), redis.hget('device:account', deviceId)])
  return tenantId !== null && accountId !== null ? { tenantId, accountId } : null
}

/** BullMQ worker that runs trip-recompute jobs. Caller must close() on shutdown. */
export function startRecomputeWorker(deps: RecomputeWorkerDeps): Worker<RecomputeJob> {
  return new Worker<RecomputeJob>(
    TRIP_RECOMPUTE_QUEUE,
    async (job: Job<RecomputeJob>) => {
      const { deviceId, from, to } = job.data
      const scope = await resolveTripScope(deps.pool, deps.redis, deviceId)
      if (scope === null) return // unregistered + no prior trip → nothing to scope
      const config = await resolveConfig(deps.redis, deviceId) // H2: match the streaming per-device config
      const res = await recomputeTrips(deps.pool, BigInt(deviceId), new Date(from), new Date(to), scope, config)
      deps.onDone?.(res)
    },
    { connection: deps.connection },
  )
}
