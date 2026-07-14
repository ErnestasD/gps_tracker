import type { NotificationChannel } from '@orbetra/shared'

import type { NotifyMessage } from './message.js'

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
  send(channel: NotificationChannel, msg: NotifyMessage): Promise<void>
}
export interface Drivers {
  email?: Driver
  telegram?: Driver
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

/** Build the configured drivers from env (absent ⇒ that channel is skipped, not failed). */
export function driversFromEnv(env: NodeJS.ProcessEnv, emailTransport?: EmailTransport): Drivers {
  const d: Drivers = {}
  const token = env['TELEGRAM_BOT_TOKEN']
  if (token) d.telegram = telegramDriver(token)
  if (emailTransport) d.email = emailDriver(emailTransport)
  return d
}
