import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Notification queue (E05-5, ADR-020). A persisted rule event is enqueued here and the
 * notify worker delivers it to the rule's channels. Retries are BullMQ's job (§6.5: "failures
 * retried by BullMQ, exp backoff, max 5"). The jobId collapses concurrent WAITING duplicates
 * of the same event (rule + device + fixTime); with removeOnComplete the id frees on success,
 * so the actual double-notify protection under an ACK replay is the worker's 24 h
 * `notify:sent:{jobId}` sent-set, not the jobId itself. Only rule-engine + device_offline
 * events (which carry a ruleId) are enqueued — geofence events have no ruleId and are not yet
 * notified (geofence-rule → channel mapping is a follow-up).
 */
export const NOTIFY_QUEUE = 'notify'

export interface NotifyJob {
  ruleId: string
  deviceId: string
  kind: string
  at: string // ISO
  payload: Record<string, unknown>
}

export function createNotifyQueue(connection: ConnectionOptions): Queue<NotifyJob> {
  return new Queue<NotifyJob>(NOTIFY_QUEUE, { connection })
}

export interface EnqueueNotifyInput {
  ruleId: string
  deviceId: bigint
  kind: string
  at: Date
  payload: Record<string, unknown>
}

export async function enqueueNotify(queue: Queue<NotifyJob>, ev: EnqueueNotifyInput): Promise<void> {
  await queue.add(
    'notify',
    { ruleId: ev.ruleId, deviceId: ev.deviceId.toString(), kind: ev.kind, at: ev.at.toISOString(), payload: ev.payload },
    {
      jobId: `notify:${ev.ruleId}:${ev.deviceId.toString()}:${ev.at.getTime()}`,
      removeOnComplete: true,
      removeOnFail: 500,
      attempts: 5, // §6.5 max 5
      backoff: { type: 'exponential', delay: 2_000 },
    },
  )
}
