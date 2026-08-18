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
// `{0,64}` — an EMPTY value is how Teltonika clears a parameter ("leave field empty if there is no
// APN username", https://wiki.teltonika-gps.com/view/FTC887_First_Start). Requiring one character
// meant the platform could set a wrong APN but never take it back, and an operator returning a
// device to stock had to reach for a phone. Empty carries no text, so it widens nothing: `;` and
// `:` stay excluded from values, which is what keeps a second command from being injected.
const SETPARAM = /^ {1,2}setparam (?:\d{1,5}:[A-Za-z0-9._@/\-+]{0,64})(?:;\d{1,5}:[A-Za-z0-9._@/\-+]{0,64})*$/
const BARE_COMMANDS = /^ {1,2}(?:getinfo|getstatus|getgps|getver|cpureset)$/
/** `getparam` takes a parameter id — the bare form does nothing on the device, so require the id. */
const GETPARAM = /^ {1,2}getparam \d{1,5}$/

export function isAllowedSmsCommand(body: string): boolean {
  if (body.length > 320) return false
  return SETPARAM.test(body) || GETPARAM.test(body) || BARE_COMMANDS.test(body)
}

/**
 * Twilio destroys the Teltonika SMS password prefix, and this is the encoding that survives it.
 *
 * Every Teltonika config command begins with whitespace standing in for an unset SMS password —
 * one space on the FT platform, two on FMB (see `smsPrefixFor` in onboarding.ts). Twilio's Messages
 * API **trims leading ASCII whitespace from `Body`**. It is undocumented; we found it in Twilio's
 * own record of our sends, which came back with the prefix already gone:
 *
 *   sent " setparam 2001:internet;…"  →  Twilio stored "setparam 2001:internet;…"
 *   sent " getinfo"                   →  Twilio stored "getinfo"
 *
 * The device then reads `setparam` as the PASSWORD and the rest as the command, and discards the
 * message in silence — no error, no reply, no effect. Two hardware sessions were lost to it, and
 * the July FMC150 failure that was blamed on an alphanumeric sender was almost certainly this.
 * Percent-encoding the space (`%20` instead of the `+` URLSearchParams emits) does not help: the
 * trim happens server-side, after decoding.
 *
 * What survives is a Unicode space that is not ASCII whitespace, converted back to a real 0x20 at
 * send time by Twilio's Smart Encoding — which is why this REQUIRES a Messaging Service with Smart
 * Encoding enabled (a bare `From` number does not run it). Measured against the live API, reading
 * back the transmitted body:
 *
 *   U+202F narrow no-break space  →  " "   (one space — FT platform)
 *   U+2007 figure space           →  "  "  (two spaces — FMB generation)
 *   U+00A0 no-break space         →  "'"   (an apostrophe — would corrupt the command)
 *   U+2000-2006, U+2008-200B, U+2009, U+205F, U+3000, U+FEFF  →  removed entirely
 *
 * Confirmed end-to-end on real hardware 2026-08-18: an FTC887 that had ignored every prior attempt
 * accepted the U+202F form, connected, and flushed 22 buffered records.
 *
 * Only the LEADING run is rewritten — interior spaces are ordinary text and must stay as they are.
 */
// Escapes, never literals: these characters are INVISIBLE. A copy-paste, a lint autofix or an
// editor that trims whitespace would silently turn them back into the ASCII spaces Twilio eats,
// and the failure that follows is completely silent — which is the whole point of this comment.
const NARROW_NO_BREAK_SPACE = '\u202F' // Twilio Smart Encoding renders this as ONE 0x20
const FIGURE_SPACE = '\u2007' //          …and this one as TWO
const TWILIO_SAFE_PREFIX: Record<number, string> = { 1: NARROW_NO_BREAK_SPACE, 2: FIGURE_SPACE }

export function twilioSafeBody(body: string): string {
  const spaces = body.length - body.replace(/^ +/, '').length
  const replacement = TWILIO_SAFE_PREFIX[spaces]
  return replacement === undefined ? body : replacement + body.slice(spaces)
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
 *
 * A Messaging Service is required TOO, because this queue carries device commands and nothing else:
 * without Smart Encoding every one of them loses its password prefix and does nothing (see
 * `twilioSafeBody`). Credentials alone would light up a "Send config SMS" button whose every press
 * fails — the same lying-button shape that made a plan-gated 403 look like a mystery outage.
 * Better the feature reads OFF and the sheet falls back to copy-paste.
 */
export function smsConfigured(env: NodeJS.ProcessEnv): boolean {
  const auth = Boolean(env['TWILIO_AUTH_TOKEN']) || Boolean(env['TWILIO_API_KEY_SID'] && env['TWILIO_API_KEY_SECRET'])
  return Boolean(env['TWILIO_ACCOUNT_SID'] && env['TWILIO_FROM'] && env['TWILIO_MESSAGING_SERVICE_SID']) && auth
}
