import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { absolutizeBrandAssets, brandingReadSchema, hasBrandAsset, notificationChannelSchema, sanitizeUnits, type Branding, type NotificationChannel } from '@orbetra/shared'

import { dispatchEvent } from '../notify/dispatch.js'
import type { Drivers } from '../notify/drivers.js'
import { brandAssetOrigin } from '../notify/tenantOrigin.js'
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
  /** platform origin, used only to absolutize an UPLOADED brand logo for a tenant that has no
   *  verified domain of their own. Absent ⇒ such a tenant's mail shows the product name as text. */
  appBaseUrl?: string | undefined
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
 * Resolve the human context for an alert: the device NAME/plate, the account's TIMEZONE, LANGUAGE
 * and UNITS, and the tenant BRAND — so the message names the vehicle (not a raw IMEI), stamps the
 * time in the account zone (rule 7), speaks the language and units that account chose, and carries
 * the tenant's white-label brand. Derived from the device row itself (the authoritative
 * tenant/account source), scoped by the device id — never a guessed scope. A lookup miss
 * (retired/unknown device) yields safe defaults so a notification is never dropped.
 */
export async function resolveNotifyContext(pool: Pool, deviceId: string, appBaseUrl?: string): Promise<NotifyContext> {
  if (!/^\d+$/.test(deviceId)) return {}
  try {
    const res = await pool.query<{
      tenant_id: string
      device_name: string | null
      device_plate: string | null
      timezone: string | null
      locale: string | null
      unitSpeed: string | null
      unitDistance: string | null
      unitVolume: string | null
      tenant_name: string | null
      branding: unknown
    }>(
      `SELECT d."tenantId" AS tenant_id, d.name AS device_name, d.plate AS device_plate,
              a.timezone AS timezone, a.locale AS locale,
              a."unitSpeed", a."unitDistance", a."unitVolume",
              t.name AS tenant_name, t.branding AS branding
         FROM devices d JOIN accounts a ON a.id = d."accountId" JOIN tenants t ON t.id = d."tenantId"
        WHERE d.id = $1`,
      [deviceId],
    )
    const row = res.rows[0]
    if (row === undefined) return {}
    // parse the untrusted branding jsonb defensively — a malformed value must never crash the
    // send path; a parse failure simply yields no branding (renderBrandedEmail then uses the name)
    // An uploaded logo is a relative path; a mail client cannot resolve one, so it is stamped with
    // the tenant's own origin here — the same rule the auth mails use (notify/tenantOrigin.ts).
    const parsedBranding = safeBranding(row.branding)
    // Only an asset path needs an origin, so a tenant linking their own https logo — or none at all
    // — pays no extra query on a path that runs once per notification. Same guard the manifest uses.
    const branding = parsedBranding === undefined || !hasBrandAsset(parsedBranding)
      ? parsedBranding
      : absolutizeBrandAssets(parsedBranding, await brandAssetOrigin(pool, row.tenant_id, appBaseUrl))
    const product = branding?.productName
    const brand = typeof product === 'string' && product.trim() !== '' ? product : row.tenant_name ?? undefined
    return {
      deviceLabel: row.device_name ?? row.device_plate ?? undefined,
      timezone: row.timezone ?? undefined,
      locale: row.locale ?? undefined,
      // sanitize rather than trust: the columns are plain TEXT with no CHECK (see the migration), so
      // an unknown value renders metric instead of throwing inside the send path
      units: sanitizeUnits(row),
      brand: brand ?? undefined,
      branding,
      tenantName: row.tenant_name ?? undefined,
    }
  } catch (err) {
    // The alert still goes out — a context lookup must never suppress one — but it goes out NAKED:
    // the raw device id instead of the vehicle, UTC instead of the fleet's zone, and 'Orbetra'
    // instead of the tenant's white-label brand. That is a visible regression for the customer and
    // was previously silent, which matters most in exactly the window that causes it: a deploy that
    // starts the new worker before `migrate deploy` adds these columns fails EVERY lookup with
    // 42703 and un-brands every alert until someone happens to notice.
    console.error('notify context lookup failed', deviceId, err instanceof Error ? err.message : String(err))
    return {}
  }
}

/** Parse the tenant `branding` jsonb into a validated Branding, or undefined on any malformed input
 *  (defense in depth — the render path also re-escapes/re-validates). Never throws. */
function safeBranding(raw: unknown): Branding | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined
  const parsed = brandingReadSchema.safeParse(raw)
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
    resolveNotifyContext(deps.pool, deviceId, deps.appBaseUrl),
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

/**
 * The same lesson the webhook worker already learned, on the queue where it matters most.
 *
 * BullMQ's default concurrency is ONE, and this worker was left on it while its siblings were fixed
 * — webhooks 8, sms 4, auth-email 4. Every job is pure I/O with a real budget behind it: up to three
 * 10 s SMTP phases, a 10 s Telegram call, and 10 s PER web-push endpoint in a sequential loop over
 * every browser an account has registered. `dispatchEvent` walks the channels one at a time, so one
 * account with a throttled SES socket or a wide push fan-out held up EVERY tenant's alerts behind
 * it — panic and overspeed included, which is the §6.5 priority-2 kind.
 *
 * Nothing here needs serialising: ordering rule 5 is about positions on a device's shard, and each
 * channel's idempotency lives in the per-job Redis sent-set, not in the queue's arrival order.
 */
/** A typo here must not take the worker down. `Number('eight')` is NaN, BullMQ rejects a
 *  non-finite concurrency at construction, and this runs at boot — so an unparseable value
 *  would crash-loop the process and stop trips, geofences, rules and billing with it. */
const NOTIFY_CONCURRENCY = ((n: number) => (Number.isFinite(n) ? n : 8))(Number(process.env['NOTIFY_CONCURRENCY']?.trim() || 8))

/** BullMQ worker delivering notifications. Caller must close() on shutdown. */
export function startNotifyWorker(deps: NotifyWorkerDeps): Worker<NotifyJob> {
  return new Worker<NotifyJob>(NOTIFY_QUEUE, (job) => runNotify(deps, job), {
    connection: deps.connection,
    concurrency: Math.min(32, Math.max(1, NOTIFY_CONCURRENCY)),
  })
}
