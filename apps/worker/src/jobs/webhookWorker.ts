import { Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'

import { writeDeliveries, type DeliveryRow } from '../webhook/deliveryLog.js'
import { assertPublicUrl } from '../webhook/guard.js'
import { signBody } from '../webhook/sign.js'
import { WEBHOOK_QUEUE, type WebhookJob } from './webhookQueue.js'

const SENT_TTL_S = 24 * 3_600
const DELIVERY_TIMEOUT_MS = 10_000 // a hanging endpoint must not pin worker concurrency (review HIGH)

export interface WebhookWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  redis: Redis
  fetchImpl?: typeof fetch
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

/** Enabled webhooks for the event's account (+ tenant-shared), subscribed to the kind.
 * Empty `events` = subscribe to ALL kinds. Raw SQL — the worker has no repo layer. */
export async function loadWebhooks(pool: Pool, tenantId: string, accountId: string, kind: string): Promise<WebhookRow[]> {
  const res = await pool.query<WebhookRow>(
    `SELECT id, url, secret, events FROM webhooks
     WHERE "tenantId" = $1 AND ("accountId" = $2 OR "accountId" IS NULL) AND enabled = true
       AND (cardinality(events) = 0 OR $3 = ANY(events))`,
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
  const fetchImpl = deps.fetchImpl ?? fetch
  const sentKey = `wh:sent:${job.id ?? eventId}`
  const failures: string[] = []
  const log: DeliveryRow[] = [] // E06-4b: one row per attempt (never the payload/secret)
  const rec = (webhookId: string, statusCode: number | null, success: boolean, error: string | null): void => {
    log.push({ tenantId, accountId, webhookId, eventId, kind, statusCode, success, error })
  }

  for (const h of hooks) {
    if ((await deps.redis.sismember(sentKey, h.id)) === 1) continue // delivered on a prior attempt
    try {
      // SSRF guard (resolve at request time; reject private/metadata targets) + redirect:error
      // (a public URL must not 302 into a private one) + a hard timeout (no hanging endpoint).
      const url = deps.resolveHost ? await assertPublicUrl(h.url, deps.resolveHost) : await assertPublicUrl(h.url)
      const res = await fetchImpl(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Signature': signBody(body, h.secret), 'X-Webhook-Id': eventId },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
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

export function startWebhookWorker(deps: WebhookWorkerDeps): Worker<WebhookJob> {
  return new Worker<WebhookJob>(WEBHOOK_QUEUE, (job) => runWebhook(deps, job), { connection: deps.connection })
}
