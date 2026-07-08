import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * BullMQ trip-recompute queue (E04-2, ADR-020). A late/buffered position batch
 * (§3.6) that the streaming engine dropped is reconciled off the hot path by a
 * recompute job over the durable positions. Redis MUST run maxmemory-policy
 * noeviction (plan §6.1) — enforced by infra, not here.
 *
 * Connection is passed as options (host/port), not a shared ioredis instance —
 * BullMQ manages its own blocking connections, and this sidesteps the ioredis
 * major-version skew between bullmq's bundled copy and the worker's.
 */
export const TRIP_RECOMPUTE_QUEUE = 'trip-recompute'

export interface RecomputeJob {
  deviceId: string
  from: string // ISO
  to: string // ISO
}

/** Parse a redis:// URL into BullMQ ConnectionOptions. */
export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.password ? { password: u.password } : {}),
    maxRetriesPerRequest: null, // BullMQ requirement
  }
}

export function createRecomputeQueue(connection: ConnectionOptions): Queue<RecomputeJob> {
  return new Queue<RecomputeJob>(TRIP_RECOMPUTE_QUEUE, { connection })
}

/**
 * Enqueue a recompute. The jobId buckets by device + hour so a burst of late signals
 * for the same region collapses into one job instead of piling up (dedupe).
 */
export async function enqueueRecompute(queue: Queue<RecomputeJob>, deviceId: bigint, from: Date, to: Date): Promise<void> {
  const bucket = from.toISOString().slice(0, 13) // yyyy-mm-ddThh
  await queue.add(
    'recompute',
    { deviceId: deviceId.toString(), from: from.toISOString(), to: to.toISOString() },
    {
      // dedupe only collapses concurrent WAITING bursts for the same device+hour;
      // removeOnComplete:true frees the id immediately so a genuinely new later batch
      // touching the same bucket can re-enqueue (a retained id would block it — review MED)
      jobId: `recompute:${deviceId}:${bucket}`,
      removeOnComplete: true,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 }, // transient DB blip → retry, not drop
    },
  )
}
