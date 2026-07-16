import type { NotificationChannel } from '@orbetra/shared'

import type { DriverContext, Drivers } from './drivers.js'
import type { NotifyMessage } from './message.js'

/**
 * Dispatch one message to a rule's channels (E05-5). Per-channel idempotency: a channel is
 * only sent if it hasn't already been delivered for this job (`alreadySent`) — so a BullMQ
 * RETRY re-attempts ONLY the channels that failed last time, never re-sending a delivered
 * one (§6.5 "every event persisted before notification; failures retried by BullMQ"). A
 * channel whose driver is unconfigured is SKIPPED (config gap, not a retryable failure).
 *
 * Returns per-outcome channel keys. The worker throws iff `failed` is non-empty, which is
 * what drives the retry — skipped channels never trigger a retry.
 */
export interface DispatchResult {
  sent: string[]
  failed: string[]
  skipped: string[]
}

const channelKey = (c: NotificationChannel): string =>
  c.type === 'email' ? `email:${c.to}` : c.type === 'telegram' ? `telegram:${c.chatId}` : 'webpush' // webpush = one fan-out per job

export async function dispatchEvent(
  channels: readonly NotificationChannel[],
  msg: NotifyMessage,
  drivers: Drivers,
  alreadySent: (key: string) => Promise<boolean>,
  markSent: (key: string) => Promise<void>,
  ctx?: DriverContext,
): Promise<DispatchResult> {
  const out: DispatchResult = { sent: [], failed: [], skipped: [] }
  for (const ch of channels) {
    const key = channelKey(ch)
    if (await alreadySent(key)) continue // delivered on a prior attempt — never re-send
    const driver = drivers[ch.type]
    if (driver === undefined) {
      out.skipped.push(key) // unconfigured channel (no creds) — not a retryable failure
      continue
    }
    try {
      await driver.send(ch, msg, ctx)
      await markSent(key) // claim AFTER success so a failed send re-attempts on retry
      out.sent.push(key)
    } catch {
      out.failed.push(key)
    }
  }
  return out
}
