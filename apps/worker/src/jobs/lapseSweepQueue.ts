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
 * This job produces that number. It does NOT cut anyone off — suspending a customer is a policy
 * decision (grace period, warning e-mail, what stays readable) that belongs to the founder, not to a
 * sweep that quietly stops a fleet from tracking.
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
      // read-only and idempotent — a retry just recomputes the same counts
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  )
}
