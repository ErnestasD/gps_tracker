import { smsConfigured, type SmsDriverResult } from '@orbetra/shared'

/**
 * SMS gateway drivers (SMS-gateway feature). A driver SENDS one SMS and either RESOLVES with the
 * provider's message id or THROWS an {@link SmsSendError} carrying the provider HTTP status so the
 * BullMQ sms worker can distinguish a PERMANENT failure (Twilio 4xx — bad number/creds; no retry)
 * from a TRANSIENT one (429/5xx/network — retry). Env-gated exactly like the email/telegram drivers:
 * absent credentials ⇒ {@link smsDriverFromEnv} returns undefined and the SMS feature is off.
 *
 * Native `fetch` only — NO twilio npm SDK (CLAUDE.md rule 10: no new runtime deps). Secrets stay in
 * the server .env (rule 12); nothing here logs a credential.
 */

/** A hanging provider endpoint must not pin the sms-worker concurrency indefinitely (same class the
 *  notify/webhook workers guard with a 10 s timeout). */
const SMS_TIMEOUT_MS = 10_000

export interface SmsDriver {
  send(to: string, body: string): Promise<SmsDriverResult>
}

/**
 * Thrown by a driver on a failed send. `status` is the provider HTTP status (0 for a network error /
 * missing response) — the worker maps it to permanent-vs-transient via {@link isPermanent}.
 */
export class SmsSendError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SmsSendError'
  }
}

/**
 * Twilio driver config carries EITHER an Auth Token OR an API Key pair (SID + secret — the
 * recommended, revocable credential). The REST URL always uses the account SID; the Basic-auth pair
 * is the account SID + auth token, OR the API key SID + secret.
 */
export type TwilioConfig =
  | { accountSid: string; from: string; authToken: string }
  | { accountSid: string; from: string; apiKeySid: string; apiKeySecret: string }

/**
 * Twilio Messages driver — HTTPS POST to the Messages resource with Basic auth and a form body,
 * via native fetch. `!res.ok` ⇒ throw SmsSendError(status) so the worker classifies it; a 2xx with
 * no `sid` in the JSON is treated as a permanent send failure (nothing to reconcile against).
 * https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
 */
export function twilioDriver(cfg: TwilioConfig, fetchImpl: typeof fetch = fetch): SmsDriver {
  // decide the Basic-auth pair from which fields are present; the URL uses accountSid regardless
  const [authUser, authPass] = 'authToken' in cfg ? [cfg.accountSid, cfg.authToken] : [cfg.apiKeySid, cfg.apiKeySecret]
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`
  const authorization = 'Basic ' + Buffer.from(`${authUser}:${authPass}`).toString('base64')
  return {
    send: async (to, body) => {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: cfg.from, Body: body }).toString(),
        signal: AbortSignal.timeout(SMS_TIMEOUT_MS), // no hanging endpoint pins the worker
      })
      if (!res.ok) throw new SmsSendError(res.status, `twilio ${res.status}`)
      const json = (await res.json()) as { sid?: unknown }
      if (typeof json.sid !== 'string' || json.sid === '') throw new SmsSendError(200, 'no sid')
      return { providerMessageId: json.sid }
    },
  }
}

/**
 * Build the configured SMS driver from env (absent ⇒ undefined ⇒ SMS feature off). Uses the shared
 * {@link smsConfigured} as the single source of truth for "is SMS configured", then picks the auth
 * pair: an Auth Token when present, otherwise the API Key SID + secret.
 */
export function smsDriverFromEnv(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): SmsDriver | undefined {
  if (!smsConfigured(env)) return undefined
  const accountSid = env['TWILIO_ACCOUNT_SID']!
  const from = env['TWILIO_FROM']!
  const authToken = env['TWILIO_AUTH_TOKEN']
  const cfg: TwilioConfig = authToken
    ? { accountSid, from, authToken }
    : { accountSid, from, apiKeySid: env['TWILIO_API_KEY_SID']!, apiKeySecret: env['TWILIO_API_KEY_SECRET']! }
  return twilioDriver(cfg, fetchImpl)
}

/**
 * Permanent vs transient classification for an {@link SmsSendError}. A Twilio 4xx (bad number,
 * unverified sender, auth failure) will never succeed on retry ⇒ permanent — EXCEPT 429 (rate
 * limited), which is transient. 5xx and a network error (status 0/absent) are transient ⇒ retry.
 */
export function isPermanent(status: number): boolean {
  if (status === 429) return false
  return status >= 400 && status < 500
}
