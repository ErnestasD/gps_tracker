import { createVerify } from 'node:crypto'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import type { Db } from '@orbetra/db'

import type { AuthEnv } from '../auth/middleware.js'

/**
 * SES bounce/complaint feedback, delivered by SNS (runbook: docs/runbooks/ses-bounce-feedback.md).
 *
 * A bounce used to be invisible to the platform: SES told a human inbox and nothing in the system
 * learned. Someone who mistyped their address at signup never got the activation link and vanished
 * without anyone noticing — and, the expensive one, the billing lapse ladder advances on SEND rather
 * than on delivery, so a customer whose billing contact address was dead was recorded as warned
 * three times and then had their fleet cut off having been warned into a void.
 *
 * THE SIGNATURE PROVES AWS SENT IT — NOT THAT IT CAME FROM US. This endpoint is public and
 * unauthenticated by necessity (SNS carries no credential) and what it does is stop us mailing an
 * address. A signature alone is NOT authorization: AWS signs every customer's topic with the same
 * regional certificate, so anyone with a free AWS account could publish a "permanent bounce" for any
 * address from their OWN topic and have the maths check out perfectly. That is why every message is
 * additionally bound to OUR topic (`expectedTopicArn`) below. Every rejection path here is a refusal
 * to act, never a best-effort guess.
 */
export interface SesWebhookDeps {
  db: Db
  /**
   * The ONE SNS topic whose messages we act on (`SES_SNS_TOPIC_ARN`). `TopicArn` is part of the
   * signed field set, so a match cannot be forged without our topic's private key.
   *
   * FAILS CLOSED when unset: an unconfigured deployment refuses every message rather than trusting
   * "AWS signed it". The cost of failing closed is a feedback feed that does not start until the
   * variable is set; the cost of failing open is that anyone can blackhole any address we mail.
   */
  expectedTopicArn?: string | undefined
  /** injected for tests; production fetches the signing certificate over HTTPS */
  fetchCert?: (url: string) => Promise<string>
  /** confirms a subscription by visiting SubscribeURL. Injected so a test never calls out. */
  confirmSubscription?: (url: string) => Promise<void>
  onEvent?: (kind: 'bounce' | 'complaint' | 'other' | 'rejected') => void
}

/**
 * Hosts we will fetch a signing certificate from.
 *
 * The classic way to break SNS verification is to accept the `SigningCertURL` at face value: an
 * attacker signs their own payload, points this at their own server, and the maths checks out
 * perfectly. The URL must be HTTPS and on an AWS SNS host, and nothing else is ever fetched.
 */
const CERT_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/

/** Fields that make up the string to sign, in the ORDER AWS specifies. Order is part of the hash. */
const SIGNED_FIELDS: Record<string, readonly string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
}

/**
 * A JSON field as a string, or ''.
 *
 * Not `String(v)`: a field that arrives as an object or an array would stringify to
 * `[object Object]` and then be HASHED as if it were real content — a signature check that quietly
 * verifies the wrong bytes. Anything that is not a string is treated as absent, which fails closed.
 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function isAwsUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && CERT_HOST_RE.test(u.hostname)
  } catch {
    return false
  }
}

/** The canonical string AWS signed: `key\nvalue\n` for each present field, in the fixed order. */
export function stringToSign(msg: Record<string, unknown>): string | null {
  // OWN KEYS ONLY. A plain object literal inherits from Object.prototype, so `Type: "constructor"`
  // (or "toString", "valueOf", "__proto__") used to resolve to an inherited FUNCTION: not undefined,
  // so the guard passed, and the for..of below then threw a TypeError out of verifySnsMessage — a
  // 500 on the one endpoint an unauthenticated caller can reach, where every other unknown type is
  // a quiet 403.
  const type = str(msg['Type'])
  const fields = Object.hasOwn(SIGNED_FIELDS, type) ? SIGNED_FIELDS[type] : undefined
  if (fields === undefined) return null
  let out = ''
  for (const f of fields) {
    const v = msg[f]
    // `Subject` is optional and is simply absent from the hash when SNS did not send it — including
    // it as an empty string produces a different digest and rejects every legitimate message
    if (typeof v !== 'string') continue
    out += `${f}\n${v}\n`
  }
  return out
}

/**
 * Verify an SNS envelope. Returns false on anything unexpected — a malformed message, an
 * unrecognised type, a certificate from a host we do not trust, or a signature that does not match.
 */
export async function verifySnsMessage(
  msg: Record<string, unknown>,
  fetchCert: (url: string) => Promise<string>,
): Promise<boolean> {
  const certUrl = str(msg['SigningCertURL'])
  const signature = str(msg['Signature'])
  const version = str(msg['SignatureVersion'])
  if (!isAwsUrl(certUrl) || signature === '') return false
  // AWS signs with SHA1 (version 1) or SHA256 (version 2). Both are accepted because AWS still emits
  // version 1 on older topics; anything else is not a version we know how to check.
  const algo = version === '1' ? 'RSA-SHA1' : version === '2' ? 'RSA-SHA256' : null
  if (algo === null) return false
  const payload = stringToSign(msg)
  if (payload === null) return false
  try {
    const cert = await fetchCert(certUrl)
    const verifier = createVerify(algo)
    verifier.update(payload, 'utf8')
    return verifier.verify(cert, signature, 'base64')
  } catch {
    // a fetch failure or a malformed certificate is a refusal to act, not a reason to trust
    return false
  }
}

/** SES publishes its event as a JSON string inside the SNS `Message` field. */
interface SesEvent {
  eventType?: string
  notificationType?: string
  mail?: { messageId?: string }
  bounce?: { bounceType?: string; bounceSubType?: string; bouncedRecipients?: { emailAddress?: string; diagnosticCode?: string }[] }
  complaint?: { complainedRecipients?: { emailAddress?: string }[]; complaintFeedbackType?: string }
}

export function createSesWebhookRoutes(deps: SesWebhookDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>()
  // SIGNING-CERT CACHE. The endpoint is public, so an anonymous caller could otherwise make us open
  // one outbound HTTPS connection per POST and hold the handler until AWS answered. AWS rotates these
  // certificates rarely and serves them from a handful of stable per-region URLs, so a small map with
  // a day's TTL removes the network from the hot path entirely; the URL is already constrained to an
  // AWS SNS host (isAwsUrl), which is what keeps the cache key from being attacker-chosen.
  const certCache = new Map<string, { pem: string; at: number }>()
  const CERT_TTL_MS = 24 * 3_600_000
  const CERT_CACHE_MAX = 8
  // AWS serves these from a fixed filename under the topic's regional host. Requiring that exact
  // shape is what makes the cache a cache: keyed on the full URL, `?nonce=1`, `?nonce=2`, … are
  // distinct keys, so an anonymous caller could force one outbound fetch per POST anyway AND push
  // the genuine certificate out of an 8-entry map. Not tightened inside isAwsUrl, because
  // SubscribeURL legitimately carries a query string and shares that helper.
  const CERT_PATH_RE = /^\/SimpleNotificationService-[A-Za-z0-9._-]+\.pem$/
  const isCanonicalCertUrl = (raw: string): boolean => {
    try {
      const u = new URL(raw)
      return u.search === '' && u.hash === '' && CERT_PATH_RE.test(u.pathname)
    } catch {
      return false
    }
  }
  const fetchCert =
    deps.fetchCert ??
    (async (url: string) => {
      // refuse rather than fetch: a certificate URL that is not the canonical shape is not ours
      if (!isCanonicalCertUrl(url)) throw new Error('non-canonical signing certificate url')
      const hit = certCache.get(url)
      if (hit !== undefined && Date.now() - hit.at < CERT_TTL_MS) return hit.pem
      // a hung AWS response must not pin the handler open — the whole verify budget is seconds
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (!res.ok) throw new Error(`cert fetch ${res.status}`)
      const pem = await res.text()
      // bounded: only evict once past the cap, so the steady state (1–2 regional certs) never churns
      if (certCache.size >= CERT_CACHE_MAX) certCache.clear()
      certCache.set(url, { pem, at: Date.now() })
      return pem
    })
  const confirm =
    deps.confirmSubscription ??
    (async (url: string) => {
      // GET-ing SubscribeURL is how the handshake completes; the URL is checked to be an AWS host
      // by the caller before we ever request it, and the topic is already proven to be ours
      await fetch(url, { signal: AbortSignal.timeout(5_000) })
    })

  app.post('/v1/webhooks/ses', bodyLimit({ maxSize: 256 * 1024 }), async (c) => {
    const raw = await c.req.text()
    let msg: Record<string, unknown>
    try {
      // the cast is NOT a formality: `JSON.parse` happily returns null / an array / a scalar, and
      // asserting `Record<string, unknown>` over `null` makes the very next property read throw a
      // TypeError that surfaces as a 500. A body of literal `null` was the one non-object shape
      // that reached the handler as a server error instead of the 403 every other one gets.
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return c.text('bad json', 400)
      }
      msg = parsed as Record<string, unknown>
    } catch {
      return c.text('bad json', 400)
    }

    if (!(await verifySnsMessage(msg, fetchCert))) {
      deps.onEvent?.('rejected')
      // 403, not 400: this is a refusal, and a distinct status makes a misconfigured subscription
      // (or an attempt) visible in the access log rather than looking like a parse problem
      return c.text('bad signature', 403)
    }

    // A VALID SIGNATURE IS NOT AUTHORIZATION. The regional certificate that signed this message signs
    // every AWS customer's topic, so without this check anyone with an AWS account could publish a
    // "permanent bounce" for any address from their own topic and be believed. `TopicArn` is inside
    // the signed field set (SIGNED_FIELDS), so it cannot be swapped after signing. Checked here —
    // BEFORE the type branch — so it covers the subscription handshake and the notification path
    // alike: gating only `confirm()` would leave a topic confirmed by an earlier deploy free to keep
    // publishing.
    const topic = str(msg['TopicArn'])
    const expected = deps.expectedTopicArn ?? ''
    if (expected === '' || topic !== expected) {
      deps.onEvent?.('rejected')
      // distinct log line from the signature refusal: this one means "genuine AWS message, wrong
      // topic" (an attempt, or SES_SNS_TOPIC_ARN not deployed), which is a different thing to chase
      console.warn('SES: refused message from an unexpected SNS topic', { topic, configured: expected !== '' })
      return c.text('unexpected topic', 403)
    }

    const type = str(msg['Type'])
    if (type === 'SubscriptionConfirmation') {
      const subscribeUrl = str(msg['SubscribeURL'])
      // …and the SubscribeURL gets the SAME host check as the certificate. It is a URL from the
      // message body that we are about to request; taking it on trust would be a server-side
      // request-forgery hole in the one endpoint an attacker can reach unauthenticated.
      if (!isAwsUrl(subscribeUrl)) return c.text('bad subscribe url', 403)
      await confirm(subscribeUrl)
      console.warn('SES: SNS subscription confirmed', { topic: msg['TopicArn'] })
      return c.text('confirmed', 200)
    }

    if (type !== 'Notification') return c.text('ignored', 200)

    let event: SesEvent
    try {
      event = JSON.parse(str(msg['Message']) || '{}') as SesEvent
    } catch {
      return c.text('bad event', 200) // acked: a message we cannot parse will not parse on retry
    }

    const kind = event.eventType ?? event.notificationType
    const messageId = str(msg['MessageId']) || null

    if (kind === 'Bounce') {
      // TRANSIENT BOUNCES ARE NOT SUPPRESSED. A full mailbox or a temporary server fault clears by
      // itself, and suppressing on it would silence a live customer permanently — the opposite of
      // the failure this endpoint exists to fix.
      if (event.bounce?.bounceType !== 'Permanent') {
        deps.onEvent?.('other')
        return c.text('ok', 200)
      }
      for (const r of event.bounce.bouncedRecipients ?? []) {
        if (r.emailAddress === undefined) continue
        await deps.db.suppressions.suppress(
          r.emailAddress,
          'bounce',
          `${event.bounce.bounceSubType ?? 'Permanent'}${r.diagnosticCode !== undefined ? `: ${r.diagnosticCode}` : ''}`.slice(0, 500),
          messageId,
        )
        console.warn('SES: address suppressed (hard bounce)', { subType: event.bounce.bounceSubType })
      }
      deps.onEvent?.('bounce')
      return c.text('ok', 200)
    }

    if (kind === 'Complaint') {
      for (const r of event.complaint?.complainedRecipients ?? []) {
        if (r.emailAddress === undefined) continue
        await deps.db.suppressions.suppress(r.emailAddress, 'complaint', event.complaint?.complaintFeedbackType ?? null, messageId)
        console.warn('SES: address suppressed (complaint)')
      }
      deps.onEvent?.('complaint')
      return c.text('ok', 200)
    }

    deps.onEvent?.('other')
    return c.text('ok', 200)
  })

  return app
}
