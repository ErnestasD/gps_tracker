import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Reject-drain queue: moves §3.6 sanity failures from the `rejects` Redis stream into
 * `raw_rejects`, so support can answer "which device, and why" instead of reading one global
 * counter (audit MED #46). Ingest cannot reach Postgres (hard rule 3), and nothing was draining
 * the stream — a rejection survived only until MAXLEN rolled over it.
 *
 * Every minute, not every second: this is a diagnostic tail. The stream is capped at ~100k, so even
 * a full backlog drains in a couple of ticks at the default batch size.
 */
export const REJECT_DRAIN_QUEUE = 'reject-drain'
export const REJECT_DRAIN_EVERY_MS = 60_000

export function createRejectDrainQueue(connection: ConnectionOptions): Queue {
  return new Queue(REJECT_DRAIN_QUEUE, { connection })
}

/** Upsert the repeatable drain. jobId keeps the schedule single across restarts/workers. */
export async function scheduleRejectDrain(queue: Queue): Promise<void> {
  await queue.add(
    'drain',
    {},
    { repeat: { every: REJECT_DRAIN_EVERY_MS }, jobId: 'reject-drain-tick', removeOnComplete: true, removeOnFail: 100 },
  )
}
