import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * device_offline sweep queue (E05-4b, §6.5). A single repeatable job fires every 60 s and
 * scans device presence against each account's `device_offline` rules. Repeatable jobs are
 * deduped by their scheduler key, so re-scheduling on every worker boot is idempotent — a
 * fleet of workers all upsert the same schedule and only one job instance runs per tick.
 */
export const DEVICE_OFFLINE_QUEUE = 'device-offline'
export const OFFLINE_SWEEP_EVERY_MS = 60_000

export function createOfflineQueue(connection: ConnectionOptions): Queue {
  return new Queue(DEVICE_OFFLINE_QUEUE, { connection })
}

/** Upsert the repeatable sweep. jobId keeps the schedule single across restarts/workers. */
export async function scheduleOfflineSweep(queue: Queue): Promise<void> {
  await queue.add(
    'sweep',
    {},
    {
      repeat: { every: OFFLINE_SWEEP_EVERY_MS },
      jobId: 'device-offline-sweep',
      removeOnComplete: true,
      removeOnFail: 100,
    },
  )
}
