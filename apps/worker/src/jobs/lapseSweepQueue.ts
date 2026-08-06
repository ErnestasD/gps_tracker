import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Daily lapsed-tenant sweep (audit MED #22).
 *
 * The entitlement floor is enforced at READ time and only through `deviceLimit`, which is consulted
 * solely when a device is created. So a canceled subscription or an expired self-serve trial takes
 * away exactly one thing — "you cannot add another device" — while the trackers keep connecting,
 * positions keep being written at our storage cost, and live/history/trips/reports keep working for
 * free, indefinitely. Nothing counted those tenants, so the leak was not just unenforced but
 * invisible: there was no list to act on and no number to alert on.
 *
 * This job now ACTS on that, on the founder's policy (2026-08-06, docs/audit/founder-decisions.md):
 * grace ends → warning, +1 day → warning, +2 days → final warning, +3 days → the tenant's devices
 * leave the ingest registry. Nothing is deleted and a payment restores the feed within one webhook,
 * but this is the one scheduled job in the product that can take a customer's live map away — read
 * `runLapseSweep` before changing anything here.
 */
export const LAPSE_SWEEP_QUEUE = 'lapse-sweep-daily'
export const LAPSE_SWEEP_EVERY_MS = 24 * 3_600_000

export function createLapseSweepQueue(connection: ConnectionOptions): Queue {
  return new Queue(LAPSE_SWEEP_QUEUE, { connection })
}

/** Upsert the repeatable daily sweep. jobId keeps the schedule single across restarts/workers. */
export async function scheduleLapseSweep(queue: Queue): Promise<void> {
  await queue.add(
    'sweep',
    {},
    {
      repeat: { every: LAPSE_SWEEP_EVERY_MS },
      jobId: 'lapse-sweep-daily',
      removeOnComplete: true,
      removeOnFail: 100,
      // Retries are safe, but NOT because the job is read-only — it suspends tenants. They are safe
      // because every step is idempotent and durably recorded: `markLapseNotice` is monotonic within
      // the lapse episode, `suspend()` is conditional on `suspendedAt IS NULL`, and the registry
      // teardown re-asserts harmlessly. A retry finishes a partial run; it cannot repeat one.
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  )
}
