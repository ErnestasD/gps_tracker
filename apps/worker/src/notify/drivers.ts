import webpush from 'web-push'

import type { PushSubscriptionRepo } from '@orbetra/db'
import type { NotificationChannel } from '@orbetra/shared'

import { assertPublicUrl } from '../webhook/guard.js'
import type { NotifyMessage } from './message.js'

/** A hanging notification endpoint must not pin BullMQ notify-worker concurrency indefinitely
 *  (the same class the webhook worker guards with DELIVERY_TIMEOUT_MS). */
const NOTIFY_TIMEOUT_MS = 10_000

/** Per-send context — the account a `webpush` channel fans out to (email/telegram ignore it). */
export interface DriverContext {
  tenantId: string
  accountId: string
}

/**
 * Notification channel drivers (E05-5). A driver SENDS one message on one channel and
 * THROWS on a transient failure (the BullMQ notify worker retries). A driver that is not
 * configured (no credentials) is simply absent from the Drivers map — the dispatcher then
 * records the channel as SKIPPED (a config gap, not a retryable failure).
 *
 * Config (creds in the server .env only — rule 12; absent ⇒ that channel is skipped, not failed):
 *  - Email: WIRED (ADR-023, SES prod access approved 2026-07-14). Set SMTP_HOST/SMTP_PORT/
 *    SMTP_USER/SMTP_PASS + MAIL_FROM (+ optional SES_CONFIG_SET) — see buildEmailTransport /
 *    docs/runbooks/aws-ses-setup.md.
 *  - Telegram: TELEGRAM_BOT_TOKEN — without it the telegram driver is absent (skipped).
 *    The token also gates the pairing deep-link (chat_id binding) built in a follow-up.
 */
export interface Driver {
  send(channel: NotificationChannel, msg: NotifyMessage, ctx?: DriverContext): Promise<void>
}
export interface Drivers {
  email?: Driver
  telegram?: Driver
  webpush?: Driver
}

/** Injected email transport — the real one (nodemailer/SES) lands with SES creds (ADR-023).
 *  `html` is the white-label branded body (E05-4); `text` is the always-present plain-text
 *  fallback for clients that don't render HTML. `html` is optional → backwards-compatible. */
export interface EmailTransport {
  send(to: string, subject: string, text: string, html?: string): Promise<void>
}

export function emailDriver(transport: EmailTransport): Driver {
  return {
    send: async (channel, msg) => {
      if (channel.type !== 'email') return
      // msg.html is the branded HTML (built by notificationMessage); msg.text is the fallback.
      await transport.send(channel.to, msg.subject, msg.text, msg.html)
    },
  }
}

/** Telegram Bot API driver — plain fetch, no dependency. Token-gated by the caller. */
export function telegramDriver(botToken: string, fetchImpl: typeof fetch = fetch): Driver {
  return {
    send: async (channel, msg) => {
      if (channel.type !== 'telegram') return
      const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: channel.chatId, text: msg.text }),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS), // no hanging endpoint pins the worker
      })
      if (!res.ok) throw new Error(`telegram sendMessage ${res.status}`)
    },
  }
}

/**
 * Web Push driver (ADR-026). A `webpush` channel carries no target — it fans out to the account's
 * stored browser subscriptions (from `ctx`). A push service `404`/`410 Gone` prunes the dead
 * subscription. Throws only on a genuine transient failure (→ BullMQ retry).
 *
 * Delivery is AT-LEAST-ONCE per browser: the whole fan-out shares one dedup key ('webpush'), so a
 * transient failure on ONE endpoint retries the job and re-pushes the already-delivered endpoints.
 * Acceptable for alerts — same-tag notifications collapse on screen — and the alternative (per-
 * endpoint idempotency) buys little for a best-effort channel.
 */
export function webPushDriver(subscriptions: PushSubscriptionRepo, resolveHost?: Parameters<typeof assertPublicUrl>[1]): Driver {
  return {
    send: async (channel, msg, ctx) => {
      if (channel.type !== 'webpush' || ctx === undefined) return
      const targets = await subscriptions.listByAccount(ctx.tenantId, ctx.accountId)
      const payload = JSON.stringify({ title: msg.subject, body: msg.text })
      let transient: unknown = null
      for (const t of targets) {
        try {
          // Blind-SSRF guard: the endpoint is a browser-supplied URL and web-push POSTs to it from
          // INSIDE the prod network carrying a VAPID Authorization header. Reject private/metadata
          // hosts at send time (resolve → reject loopback/link-local/ULA/etc.), mirroring the
          // hardened webhook path. A pruneable dead endpoint is left to the 404/410 handling below.
          await (resolveHost ? assertPublicUrl(t.endpoint, resolveHost) : assertPublicUrl(t.endpoint))
          await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, { timeout: NOTIFY_TIMEOUT_MS })
        } catch (err) {
          if (err instanceof Error && err.name === 'UnsafeUrlError') {
            // an endpoint pointing at private infra is not a transient failure and never will be —
            // prune it so it stops being attempted, and do NOT surface it as a retryable error
            await subscriptions.deleteByEndpoint(t.endpoint)
            continue
          }
          const status = (err as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) await subscriptions.deleteByEndpoint(t.endpoint) // gone → prune
          else transient = err // a real failure → surface after the loop (don't abort other targets)
        }
      }
      if (transient !== null) throw transient instanceof Error ? transient : new Error('web push send failed')
    },
  }
}

export interface DriversEnvDeps {
  emailTransport?: EmailTransport | undefined
  /** push subscriptions repo + VAPID keys enable the webpush channel (ADR-026). */
  subscriptions?: PushSubscriptionRepo | undefined
}

/** Build the configured drivers from env (absent ⇒ that channel is skipped, not failed). */
export function driversFromEnv(env: NodeJS.ProcessEnv, deps: DriversEnvDeps = {}): Drivers {
  const d: Drivers = {}
  const token = env['TELEGRAM_BOT_TOKEN']
  if (token) d.telegram = telegramDriver(token)
  if (deps.emailTransport) d.email = emailDriver(deps.emailTransport)
  const vapidPub = env['VAPID_PUBLIC_KEY']
  const vapidPriv = env['VAPID_PRIVATE_KEY']
  if (vapidPub && vapidPriv && deps.subscriptions) {
    try {
      webpush.setVapidDetails(env['VAPID_SUBJECT'] ?? 'mailto:ops@orbetra.com', vapidPub, vapidPriv)
      d.webpush = webPushDriver(deps.subscriptions)
    } catch {
      // malformed VAPID keys must NEVER crash the worker startup — skip the channel (like a missing cred)
      console.error('web push disabled: invalid VAPID keys') // no secrets in the log
    }
  }
  return d
}
