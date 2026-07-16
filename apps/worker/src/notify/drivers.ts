import webpush from 'web-push'

import type { PushSubscriptionRepo } from '@orbetra/db'
import type { NotificationChannel } from '@orbetra/shared'

import type { NotifyMessage } from './message.js'

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

/** Injected email transport — the real one (nodemailer/SES) lands with SES creds (ADR-022). */
export interface EmailTransport {
  send(to: string, subject: string, text: string): Promise<void>
}

export function emailDriver(transport: EmailTransport): Driver {
  return {
    send: async (channel, msg) => {
      if (channel.type !== 'email') return
      await transport.send(channel.to, msg.subject, msg.text)
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
export function webPushDriver(subscriptions: PushSubscriptionRepo): Driver {
  return {
    send: async (channel, msg, ctx) => {
      if (channel.type !== 'webpush' || ctx === undefined) return
      const targets = await subscriptions.listByAccount(ctx.tenantId, ctx.accountId)
      const payload = JSON.stringify({ title: msg.subject, body: msg.text })
      let transient: unknown = null
      for (const t of targets) {
        try {
          await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload)
        } catch (err) {
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
