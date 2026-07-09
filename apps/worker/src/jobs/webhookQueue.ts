import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Webhook delivery queue (E06-4, ADR-020). A persisted event is enqueued here and the
 * webhook worker POSTs it (HMAC-signed) to every enabled webhook of the event's account
 * that subscribes to the kind. Retries are BullMQ's (§6.5 exp backoff, max 5). The jobId
 * dedups a re-enqueue of the same event under the ACK-replay window; the worker resolves the
 * account from the deviceId (registry), so the payload stays scope-free like the notify job.
 */
export const WEBHOOK_QUEUE = 'webhook'

export interface WebhookJob {
  /** stable per-event id — the delivery's `X-Webhook-Id` (receiver dedup key) + jobId suffix */
  eventId: string
  deviceId: string
  kind: string
  at: string // ISO
  payload: Record<string, unknown>
}

export function createWebhookQueue(connection: ConnectionOptions): Queue<WebhookJob> {
  return new Queue<WebhookJob>(WEBHOOK_QUEUE, { connection })
}

export interface EnqueueWebhookInput {
  deviceId: bigint
  kind: string
  at: Date
  payload: Record<string, unknown>
  /** discriminator making the event UNIQUE within a device+kind+ms (review MED): ruleId for
   * rule/offline events, `${geofenceId}:${transition}` for geofence — else two distinct events
   * at the same millisecond would share a jobId and one would be dropped by dedup. */
  dedupe: string
}

export async function enqueueWebhook(queue: Queue<WebhookJob>, ev: EnqueueWebhookInput): Promise<void> {
  const eventId = `${ev.deviceId.toString()}:${ev.kind}:${ev.at.getTime()}:${ev.dedupe}`
  await queue.add(
    'deliver',
    { eventId, deviceId: ev.deviceId.toString(), kind: ev.kind, at: ev.at.toISOString(), payload: ev.payload },
    {
      jobId: `wh:${eventId}`, // includes the discriminator → replay-dedup without collisions
      removeOnComplete: true,
      removeOnFail: 500,
      attempts: 5, // §6.5 max 5
      backoff: { type: 'exponential', delay: 2_000 },
    },
  )
}
