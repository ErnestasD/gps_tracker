import { z } from 'zod'

/**
 * SMS gateway contracts (SMS gateway feature) — the single source of types shared by api, worker
 * and web. V1 sends Teltonika config SMS to a device's SIM via the platform-default Twilio driver
 * (env-gated exactly like email). `buildOnboarding` (onboarding.ts) still GENERATES the config SMS
 * strings; this module carries only the send contract + delivery view + the env-configured check.
 */

/** Delivery lifecycle — mirrors the Prisma `SmsStatus` enum. queued → sent | failed (terminal). */
export const SMS_STATUSES = ['queued', 'sent', 'failed'] as const
export type SmsStatus = (typeof SMS_STATUSES)[number]

/**
 * POST /v1/devices/:id/sms body. Both fields optional: with no `body` the API builds the device's
 * config SMS via buildOnboarding (the common case); `apn` lets the operator include the carrier APN
 * in that generated SMS. A future arbitrary-command send fills `body` directly. Bounds: an SMS is
 * ≤160 GSM-7 chars per segment; 320 allows a two-segment config SMS without unbounded input.
 */
export const smsSendRequestSchema = z.object({
  body: z.string().min(1).max(320).optional(),
  apn: z.string().max(63).optional(),
})
export type SmsSendRequest = z.infer<typeof smsSendRequestSchema>

/** What an SmsDriver returns on a successful send — the provider's message id (for audit + status). */
export interface SmsDriverResult {
  providerMessageId: string
}

/** A persisted SMS delivery as returned by the read API (mirrors the Prisma SmsDelivery, serialized). */
export interface SmsDeliveryView {
  id: string
  deviceId: string
  to: string
  body: string
  provider: string
  providerMessageId: string | null
  status: SmsStatus
  error: string | null
  createdAt: string // ISO
  sentAt: string | null // ISO
}

/**
 * Whether the SMS gateway is configured server-side — the SINGLE source of truth imported by BOTH
 * the api (503 when unconfigured) and the worker (skip the driver), exactly like the email channel.
 * Requires the account SID + a From number + EITHER auth method: an Auth Token, OR an API Key
 * (SID + secret — the recommended, revocable Twilio credential). Absent ⇒ feature off. Secrets stay
 * in the server .env (rule 12); this reads presence only, never logs values.
 */
export function smsConfigured(env: NodeJS.ProcessEnv): boolean {
  const auth = Boolean(env['TWILIO_AUTH_TOKEN']) || Boolean(env['TWILIO_API_KEY_SID'] && env['TWILIO_API_KEY_SECRET'])
  return Boolean(env['TWILIO_ACCOUNT_SID'] && env['TWILIO_FROM']) && auth
}
