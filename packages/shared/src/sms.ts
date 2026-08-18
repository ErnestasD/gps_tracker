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

/**
 * Allow-list for a caller-supplied SMS body.
 *
 * The route sends from the PLATFORM's Twilio sender to a caller-chosen E.164 number, so free-form
 * text is a smishing relay wearing a device-command costume — and every message is unrecoverable
 * platform spend. Until an arbitrary-command feature is actually designed, a supplied body must be
 * a Teltonika configuration command of the same shape the onboarding sheet generates:
 * `<prefix>setparam <id>:<value>[;<id>:<value>…]`, or one of the parameterless diagnostics. `;` and
 * `:` inside a value would inject a second command, so the value charset excludes them, exactly as
 * the APN sanitizer does.
 *
 * The prefix stands in for an unset SMS password and is ONE space or TWO depending on the platform
 * — see `smsPrefixFor` in onboarding.ts, which carries the two wiki citations. Both are accepted
 * here: this list must admit every string the sheet itself generates, or an operator who pastes our
 * own FTC887 command back into the body field is refused by our own validator.
 */
const SETPARAM = /^ {1,2}setparam (?:\d{1,5}:[A-Za-z0-9._@/\-+]{1,64})(?:;\d{1,5}:[A-Za-z0-9._@/\-+]{1,64})*$/
const BARE_COMMANDS = /^ {1,2}(?:getinfo|getstatus|getgps|getver|cpureset)$/
/** `getparam` takes a parameter id — the bare form does nothing on the device, so require the id. */
const GETPARAM = /^ {1,2}getparam \d{1,5}$/

export function isAllowedSmsCommand(body: string): boolean {
  if (body.length > 320) return false
  return SETPARAM.test(body) || GETPARAM.test(body) || BARE_COMMANDS.test(body)
}

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
