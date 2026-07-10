import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Usage-metering sweep queue (E07-4, §8 W7 S4). A repeatable job marks each registered
 * device that has reported "today" as a billable device-day in `usage_daily` (V1-MUST
 * metering; month-close billing consumes it, §6.9). Hourly cadence: a device is counted the
 * hour after it first reports on a given day; ON CONFLICT makes re-sweeps free. Same
 * repeatable-idempotency notes as the offline sweeper (deterministic scheduler key).
 */
export const USAGE_QUEUE = 'usage-sweep'
export const USAGE_SWEEP_EVERY_MS = 60 * 60_000 // hourly

export function createUsageQueue(connection: ConnectionOptions): Queue {
  return new Queue(USAGE_QUEUE, { connection })
}

/** Upsert the repeatable sweep. jobId keeps the schedule single across restarts/workers. */
export async function scheduleUsageSweep(queue: Queue): Promise<void> {
  await queue.add(
    'sweep',
    {},
    {
      repeat: { every: USAGE_SWEEP_EVERY_MS },
      jobId: 'usage-daily-sweep',
      removeOnComplete: true,
      removeOnFail: 100,
    },
  )
}
