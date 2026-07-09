import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { notificationChannelSchema, type NotificationChannel } from '@orbetra/shared'

import { dispatchEvent } from '../notify/dispatch.js'
import type { Drivers } from '../notify/drivers.js'
import { notificationMessage } from '../notify/message.js'
import { NOTIFY_QUEUE, type NotifyJob } from './notifyQueue.js'

/** Sent-set TTL: bounds the per-job idempotency key well past the max retry window. */
const SENT_TTL_S = 24 * 3_600

export interface NotifyWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  redis: Redis
  drivers: Drivers
  onSent?: (channel: string) => void
  onFailed?: (channel: string) => void
  onSkipped?: (reason: string) => void
}

/** Read a rule's channels from the DB (raw SQL — the worker has no repo layer). An absent or
 * disabled rule yields no channels (nothing to send). Invalid channel entries are dropped. */
export async function loadRuleChannels(pool: Pool, ruleId: string): Promise<NotificationChannel[]> {
  const res = await pool.query<{ channels: unknown }>('SELECT channels FROM rules WHERE id = $1 AND enabled = true', [ruleId])
  const raw = res.rows[0]?.channels
  if (!Array.isArray(raw)) return []
  const out: NotificationChannel[] = []
  for (const c of raw) {
    const parsed = notificationChannelSchema.safeParse(c)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/** Run one notify job: load channels → build message → dispatch with per-channel dedup. */
export async function runNotify(deps: NotifyWorkerDeps, job: Job<NotifyJob>): Promise<void> {
  const { ruleId, deviceId, kind, at, payload } = job.data
  const channels = await loadRuleChannels(deps.pool, ruleId)
  if (channels.length === 0) return

  const msg = notificationMessage(kind, deviceId, payload, new Date(at))
  const sentKey = `notify:sent:${job.id ?? `${ruleId}:${deviceId}:${at}`}`
  const result = await dispatchEvent(
    channels,
    msg,
    deps.drivers,
    (k) => deps.redis.sismember(sentKey, k).then((n) => n === 1),
    async (k) => {
      // pipeline SADD+EXPIRE together so a crash between them can't leave a TTL-less key
      // accumulating forever under the mandated noeviction Redis (review LOW-1)
      await deps.redis.pipeline().sadd(sentKey, k).expire(sentKey, SENT_TTL_S).exec()
    },
  )

  for (const c of result.sent) deps.onSent?.(c.split(':')[0]!)
  for (const c of result.failed) deps.onFailed?.(c.split(':')[0]!)
  result.skipped.forEach(() => deps.onSkipped?.('unconfigured'))

  // any configured channel that failed → throw so BullMQ retries (already-sent channels are
  // recorded in the sent-set and won't be re-sent on the next attempt)
  if (result.failed.length > 0) throw new Error(`notify: ${result.failed.length} channel(s) failed for rule ${ruleId}`)
}

/** BullMQ worker delivering notifications. Caller must close() on shutdown. */
export function startNotifyWorker(deps: NotifyWorkerDeps): Worker<NotifyJob> {
  return new Worker<NotifyJob>(NOTIFY_QUEUE, (job) => runNotify(deps, job), { connection: deps.connection })
}
