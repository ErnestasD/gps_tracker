import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { writeDeliveries, type DeliveryRow } from '../webhook/deliveryLog.js'
import { assertPublicUrl } from '../webhook/guard.js'
import { deliverWebhook, type DeliverOptions, type DeliverResult } from '../webhook/deliver.js'
import { signBody } from '../webhook/sign.js'
import { WEBHOOK_QUEUE, type WebhookJob } from './webhookQueue.js'

const SENT_TTL_S = 24 * 3_600
const DELIVERY_TIMEOUT_MS = 10_000 // a hanging endpoint must not pin worker concurrency (review HIGH)

export interface WebhookWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  redis: Redis
  /** injectable delivery, for tests — production dials the validated IP via node:https (ADR-035) */
  deliverImpl?: (opts: DeliverOptions) => Promise<DeliverResult>
  /** injected DNS resolver for the SSRF guard (tests); defaults to node:dns lookup. */
  resolveHost?: Parameters<typeof assertPublicUrl>[1]
  onDelivered?: () => void
  onFailed?: () => void
}

interface WebhookRow {
  id: string
  url: string
  secret: string
  events: string[]
}

/**
 * Enabled webhooks for the event's account (+ tenant-shared), subscribed to the kind.
 * Empty `events` = subscribe to ALL kinds. Raw SQL — the worker has no repo layer.
 *
 * The tenant's PLAN is part of the predicate. It was not, so a tenant whose subscription lapsed —
 * or who downgraded to a Direct plan, where `webhooks` is false — kept receiving deliveries
 * indefinitely: the API refused to create new ones, but nothing stopped the existing ones firing.
 * FLOOR_ENTITLEMENTS claims to stop a non-paying tenant keeping billable features; for webhooks it
 * was decorative. Audit MED.
 *
 * `subscriptionStatus` NULL means admin-granted / never subscribed, which keeps its plan — the same
 * rule `effectiveEntitlements` applies, kept here as one SQL predicate so the two cannot drift on a
 * hot path that runs per event.
 */
export async function loadWebhooks(pool: Pool, tenantId: string, accountId: string, kind: string): Promise<WebhookRow[]> {
  const res = await pool.query<WebhookRow>(
    `SELECT w.id, w.url, w.secret, w.events FROM webhooks w
       JOIN tenants t ON t.id = w."tenantId"
     WHERE w."tenantId" = $1 AND (w."accountId" = $2 OR w."accountId" IS NULL) AND w.enabled = true
       AND (cardinality(w.events) = 0 OR $3 = ANY(w.events))
       AND t.plan::text LIKE 'tsp!_%' ESCAPE '!'
       AND (t."subscriptionStatus" IS NULL OR t."subscriptionStatus" NOT IN ('canceled','unpaid','incomplete_expired','paused'))`,
    [tenantId, accountId, kind],
  )
  return res.rows
}

/** Run one webhook job: resolve scope → load matching webhooks → HMAC-POST each (deduped). */
export async function runWebhook(deps: WebhookWorkerDeps, job: Job<WebhookJob>): Promise<void> {
  const { eventId, deviceId, kind, at, payload } = job.data
  const [tenantId, accountId] = await Promise.all([deps.redis.hget('device:tenant', deviceId), deps.redis.hget('device:account', deviceId)])
  if (tenantId === null || accountId === null) return // unregistered device → cannot scope; drop

  const hooks = await loadWebhooks(deps.pool, tenantId, accountId, kind)
  if (hooks.length === 0) return

  const body = JSON.stringify({ kind, deviceId, at, payload })
  const deliver = deps.deliverImpl ?? deliverWebhook
  const sentKey = `wh:sent:${job.id ?? eventId}`
  const failures: string[] = []
  const log: DeliveryRow[] = [] // E06-4b: one row per attempt (never the payload/secret)
  const rec = (webhookId: string, statusCode: number | null, success: boolean, error: string | null): void => {
    log.push({ tenantId, accountId, webhookId, eventId, kind, statusCode, success, error })
  }

  for (const h of hooks) {
    if ((await deps.redis.sismember(sentKey, h.id)) === 1) continue // delivered on a prior attempt
    try {
      // SSRF guard: resolve at request time, reject private/metadata targets — and then dial THE
      // VALIDATED ADDRESS rather than the hostname (ADR-035). Handing the hostname to fetch let
      // undici resolve a second time, which is a rebinding window a tenant admin who controls the
      // DNS record can drive straight into our metadata service. Redirects are refused (same
      // escalation, another route) and a hard timeout bounds a hanging endpoint.
      const validated = deps.resolveHost ? await assertPublicUrl(h.url, deps.resolveHost) : await assertPublicUrl(h.url)
      const res = await deliver({
        url: validated.url,
        ip: validated.ip,
        headers: { 'content-type': 'application/json', 'X-Signature': signBody(body, h.secret), 'X-Webhook-Id': eventId },
        body,
        timeoutMs: DELIVERY_TIMEOUT_MS,
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      await deps.redis.pipeline().sadd(sentKey, h.id).expire(sentKey, SENT_TTL_S).exec() // claim AFTER success
      deps.onDelivered?.()
      rec(h.id, res.status, true, null)
    } catch (err) {
      // network error / non-2xx / timeout / unsafe-url → count + retry (unsafe-url will keep
      // failing until the admin fixes it, then removeOnFail:500 retains it for inspection)
      deps.onFailed?.()
      failures.push(h.id)
      const status = /status (\d+)/.exec(err instanceof Error ? err.message : '')
      rec(h.id, status ? Number(status[1]) : null, false, (err instanceof Error ? err.message : 'error').slice(0, 200))
    }
  }
  // record the attempts (best-effort — a log-write failure must not fail delivery/retry)
  if (log.length > 0) await writeDeliveries(deps.pool, log).catch((e: unknown) => console.error('writeDeliveries', e))
  // any endpoint still failing → throw so BullMQ retries (delivered ones are in the sent-set)
  if (failures.length > 0) throw new Error(`webhook: ${failures.length} endpoint(s) failed for ${kind}`)
}

/**
 * BullMQ's default concurrency is ONE, which made a single slow endpoint the whole queue's problem:
 * every tenant's alerts queued behind it for as long as it took. Deliveries are pure I/O with a hard
 * per-request deadline, so several in flight cost nothing and one sick endpoint now delays at most
 * its own share.
 */
/** A typo here must not take the worker down. `Number('eight')` is NaN, BullMQ rejects a
 *  non-finite concurrency at construction, and this runs at boot — so an unparseable value
 *  would crash-loop the process and stop trips, geofences, rules and billing with it. */
const WEBHOOK_CONCURRENCY = ((n: number) => (Number.isFinite(n) ? n : 8))(Number(process.env['WEBHOOK_CONCURRENCY']?.trim() || 8))

export function startWebhookWorker(deps: WebhookWorkerDeps): Worker<WebhookJob> {
  return new Worker<WebhookJob>(WEBHOOK_QUEUE, (job) => runWebhook(deps, job), {
    connection: deps.connection,
    concurrency: Math.min(32, Math.max(1, WEBHOOK_CONCURRENCY)),
  })
}
