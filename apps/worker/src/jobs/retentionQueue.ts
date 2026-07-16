import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Data-retention sweep queue. A repeatable daily job prunes the webhook delivery-log
 * (`webhook_deliveries`) of rows older than the retention window — an operational log that
 * would otherwise grow unbounded (E06-4b left retention as a follow-up). Same repeatable-
 * idempotency notes as the usage/offline sweepers (a single deterministic scheduler key).
 */
export const RETENTION_QUEUE = 'retention-sweep'
export const RETENTION_SWEEP_EVERY_MS = 24 * 60 * 60_000 // daily

export function createRetentionQueue(connection: ConnectionOptions): Queue {
  return new Queue(RETENTION_QUEUE, { connection })
}

/** Upsert the repeatable sweep. jobId keeps the schedule single across restarts/workers. */
export async function scheduleRetentionSweep(queue: Queue): Promise<void> {
  await queue.add(
    'sweep',
    {},
    {
      repeat: { every: RETENTION_SWEEP_EVERY_MS },
      jobId: 'retention-daily-sweep',
      removeOnComplete: true,
      removeOnFail: 100,
    },
  )
}
