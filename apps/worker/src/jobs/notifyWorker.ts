import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { brandingSchema, notificationChannelSchema, type Branding, type NotificationChannel } from '@orbetra/shared'

import { dispatchEvent } from '../notify/dispatch.js'
import type { Drivers } from '../notify/drivers.js'
import { notificationMessage, type NotifyContext } from '../notify/message.js'
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

/**
 * Resolve the human context for an alert: the device NAME/plate, the account TIMEZONE, and the
 * tenant BRAND — so the message names the vehicle (not a raw IMEI), stamps the time in the account
 * zone (rule 7), and uses the tenant's white-label brand. Derived from the device row itself (the
 * authoritative tenant/account source), scoped by the device id — never a guessed scope. A lookup
 * miss (retired/unknown device) yields safe defaults so a notification is never dropped.
 */
export async function resolveNotifyContext(pool: Pool, deviceId: string): Promise<NotifyContext> {
  if (!/^\d+$/.test(deviceId)) return {}
  try {
    const res = await pool.query<{ device_name: string | null; device_plate: string | null; timezone: string | null; tenant_name: string | null; branding: unknown }>(
      `SELECT d.name AS device_name, d.plate AS device_plate, a.timezone AS timezone, t.name AS tenant_name, t.branding AS branding
         FROM devices d JOIN accounts a ON a.id = d."accountId" JOIN tenants t ON t.id = d."tenantId"
        WHERE d.id = $1`,
      [deviceId],
    )
    const row = res.rows[0]
    if (row === undefined) return {}
    // parse the untrusted branding jsonb defensively — a malformed value must never crash the
    // send path; a parse failure simply yields no branding (renderBrandedEmail then uses the name)
    const branding = safeBranding(row.branding)
    const product = branding?.productName
    const brand = typeof product === 'string' && product.trim() !== '' ? product : row.tenant_name ?? undefined
    return {
      deviceLabel: row.device_name ?? row.device_plate ?? undefined,
      timezone: row.timezone ?? undefined,
      brand: brand ?? undefined,
      branding,
      tenantName: row.tenant_name ?? undefined,
    }
  } catch {
    return {} // context lookup must never suppress the alert — fall back to id/UTC/'Orbetra'
  }
}

/** Parse the tenant `branding` jsonb into a validated Branding, or undefined on any malformed input
 *  (defense in depth — the render path also re-escapes/re-validates). Never throws. */
function safeBranding(raw: unknown): Branding | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined
  const parsed = brandingSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

/** Run one notify job: load channels → build message → dispatch with per-channel dedup. */
export async function runNotify(deps: NotifyWorkerDeps, job: Job<NotifyJob>): Promise<void> {
  const { ruleId, deviceId, kind, at, payload } = job.data
  const channels = await loadRuleChannels(deps.pool, ruleId)
  if (channels.length === 0) return

  // resolve the device's account (webpush fan-out) + the human context (name/zone/brand) together
  const [tenantId, accountId, notifyCtx] = await Promise.all([
    deps.redis.hget('device:tenant', deviceId),
    deps.redis.hget('device:account', deviceId),
    resolveNotifyContext(deps.pool, deviceId),
  ])
  const msg = notificationMessage(kind, deviceId, payload, new Date(at), notifyCtx)
  const sentKey = `notify:sent:${job.id ?? `${ruleId}:${deviceId}:${at}`}`
  const ctx = tenantId && accountId ? { tenantId, accountId } : undefined
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
    ctx,
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
