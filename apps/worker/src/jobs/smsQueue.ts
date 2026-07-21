import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * SMS send queue (SMS-gateway feature). The API (which cannot send SMS — the Twilio driver lives in
 * the worker, mirroring email/SES) persists an sms_deliveries row then enqueues here; the worker
 * sends via the env-gated driver and reconciles the row's status. One kind today: a Teltonika config
 * SMS; the shape leaves room for arbitrary command SMS later without a new queue.
 */
export const SMS_QUEUE = 'sms'

export interface SmsJob {
  /** the persisted sms_deliveries row this job sends (idempotency key + status target) */
  smsDeliveryId: string
  /** device the SMS configures (audit/context; the worker does not re-resolve it) */
  deviceId: string
  /** owning tenant — scope for any future per-tenant driver selection */
  tenantId: string
  /** destination MSISDN (the device SIM's phone number) */
  to: string
  /** the SMS text (a config SMS from buildOnboarding, or a future arbitrary command) */
  body: string
  /** provider label recorded on the delivery row (e.g. 'twilio') */
  provider: string
}

export function createSmsQueue(connection: ConnectionOptions): Queue<SmsJob> {
  return new Queue<SmsJob>(SMS_QUEUE, { connection })
}

/**
 * Enqueue an SMS send. `jobId` is derived from the delivery row id so a duplicate enqueue collapses
 * (BullMQ dedups by jobId) — the row is the send's identity. Bounded exponential retries cover a
 * transient provider blip; a permanently-failing job is dropped (removeOnFail) so it can't wedge the
 * queue. The worker also guards against a double CHARGE via a Redis claim key (see smsWorker).
 */
export async function enqueueSms(queue: Queue<SmsJob>, job: SmsJob): Promise<void> {
  await queue.add('sms', job, {
    jobId: `sms-${job.smsDeliveryId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 500,
  })
}
