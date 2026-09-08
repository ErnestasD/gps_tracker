import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Finish a tenant's sending-domain verification without anybody watching (ADR-036).
 *
 * The settings panel polls and advances itself, which is right while somebody has it open — and it
 * was the ONLY thing that advanced it. A reseller publishes their DKIM records, closes the tab, and
 * SES flips the identity to verified an hour later with nothing there to notice: the row stays
 * `pending` for ever and their mail keeps going out on the PLATFORM address. Silently, because
 * everything about that state looks like the normal wait.
 *
 * Observed on the founder's own domain: SES mailed
 * `AWS_SES_DKIM_PENDING_TO_VERIFIED` for dokigo.lt while `tenant_sending_domains.status` was still
 * `pending`, because the tab was closed.
 *
 * So the panel is the fast path and this is the one that guarantees the outcome. Ten minutes: DKIM
 * takes up to an hour to flip, so a tighter interval only asks SES more often for the same answer,
 * and a looser one leaves a reseller sending as us for longer than they think they are.
 */
export const SENDING_VERIFY_QUEUE = 'sending-verify-sweep'
export const SENDING_VERIFY_EVERY_MS = 10 * 60_000

export function createSendingVerifyQueue(connection: ConnectionOptions): Queue {
  return new Queue(SENDING_VERIFY_QUEUE, { connection })
}

/** Upsert the repeatable sweep. jobId keeps the schedule single across restarts/workers. */
export async function scheduleSendingVerify(queue: Queue): Promise<void> {
  await queue.add(
    'sweep',
    {},
    {
      repeat: { every: SENDING_VERIFY_EVERY_MS },
      jobId: 'sending-verify-sweep',
      removeOnComplete: true,
      removeOnFail: 100,
      // Retries are safe because every step is idempotent: the DNS re-check is a read, and marking a
      // row verified is conditional on it not already being so. A retry finishes a partial run.
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  )
}
