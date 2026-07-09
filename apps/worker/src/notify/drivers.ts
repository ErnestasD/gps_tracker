import type { NotificationChannel } from '@orbetra/shared'

import type { NotifyMessage } from './message.js'

/**
 * Notification channel drivers (E05-5). A driver SENDS one message on one channel and
 * THROWS on a transient failure (the BullMQ notify worker retries). A driver that is not
 * configured (no credentials) is simply absent from the Drivers map — the dispatcher then
 * records the channel as SKIPPED (a config gap, not a retryable failure).
 *
 * BLOCKED-INFO (founder must provision — see project-status memory):
 *  - Telegram: TELEGRAM_BOT_TOKEN — without it the telegram driver is absent (skipped).
 *    The token also gates the pairing deep-link (chat_id binding) built in a follow-up.
 *  - Email: an SMTP/SES transport (AWS SES eu-central-1 production access + MAIL_FROM).
 *    The email driver takes an injected transport; until one is wired it is absent (skipped).
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
