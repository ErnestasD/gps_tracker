import nodemailer from 'nodemailer'

import type { EmailTransport } from './drivers.js'

/**
 * Concrete SMTP e-mail transport (E05-5, ADR-023). Reads DISCRETE env vars — NOT a single
 * SMTP_URL: SES SMTP passwords are base64 (`A–Z a–z 0–9 + / =`), and a `/` in a URL password is
 * parsed as the path start (silent wrong-cred misparse) while other chars throw the URL parser
 * (worker-wide crash). An options object sidesteps URL parsing entirely (review HIGH-3).
 *   SMTP_HOST = email-smtp.eu-central-1.amazonaws.com
 *   SMTP_PORT = 587            (STARTTLS; 465 ⇒ implicit TLS)   [optional, default 587]
 *   SMTP_USER / SMTP_PASS = SES SMTP credentials
 *   MAIL_FROM = alerts@<domain>            (a DKIM-verified SES identity)
 *   SES_CONFIG_SET (optional) = the SES configuration set for bounce/complaint routing
 * Env-gated like every driver: any missing required var ⇒ returns undefined ⇒ the email channel is
 * SKIPPED (a config gap, not a retryable failure). Secrets live only in the server .env (rule 12).
 *
 * `createTransport` is injectable so tests exercise the send mapping without a live SMTP server.
 */
export interface MailSender {
  sendMail(opts: { from: string; replyTo?: string; to: string; subject: string; text: string; html?: string; headers?: Record<string, string> }): Promise<unknown>
}
export interface SmtpOptions {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
  /** ms to establish the TCP connection */
  connectionTimeout?: number
  /** ms to wait for the SMTP greeting after connecting */
  greetingTimeout?: number
  /** ms of socket inactivity before the send is abandoned — the one that catches a half-open socket */
  socketTimeout?: number
}
type CreateTransport = (opts: SmtpOptions) => MailSender

// RFC 6761 / RFC 2606 special-use TLDs that never resolve → mail to them ALWAYS bounces. Sending to
// them (e.g. a demo tenant's demo-admin@orbetra.test) racks up SES bounces, which damage sender
// reputation and can get the whole account throttled/suspended. We never even attempt delivery.
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost'])
/** True when an address CAN be delivered (its domain's last label isn't a reserved-use TLD). */
export function isDeliverableAddress(addr: string): boolean {
  const domain = (addr.split('@')[1] ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (domain === '') return false
  return !RESERVED_TLDS.has(domain.split('.').pop() ?? '')
}

/**
 * Which of these addresses has SES already told us are dead? Returns the SUPPRESSED subset.
 *
 * Injected rather than built from a `pg.Pool` here: a mail transport had no database coupling at
 * all, and giving it one to answer a yes/no question puts raw SQL in the wrong module and makes the
 * behaviour untestable without a container. One query for the whole recipient list, not one per
 * address — a comma-separated scheduled-report row can carry a dozen.
 */
export type SuppressionLookup = (addresses: readonly string[]) => Promise<ReadonlySet<string>>

/**
 * Read the suppression list on the SEND path. Fails OPEN, deliberately: a lookup fault must never
 * silence a live customer — the worst case of sending one extra message to a dead address is one
 * bounce; the worst case of the opposite is an owner who never learns their vehicle was stolen.
 *
 * The query itself lives in the suppressions REPO, which owns this table. Hand-writing it here
 * would have been the third copy of the same SELECT in the codebase, in a module that otherwise has
 * no database coupling at all (hard rule 2).
 */
export function suppressionLookup(repo: { suppressedAmong(a: readonly string[]): Promise<ReadonlySet<string>> }): SuppressionLookup {
  return async (addresses) => {
    try {
      return await repo.suppressedAmong(addresses)
    } catch {
      return new Set()
    }
  }
}

/**
 * @param suppressed the suppression check. The auth worker made the argument one level down —
 * "dropped here rather than at each producer: there are five of them and one send path" — and then
 * the rule-event alerts and the scheduled reports went out through a DIFFERENT send path that
 * checked nothing. Every sender in the product converges on this transport, so the check belongs
 * here; omitting it keeps the old behaviour for a caller that has no database.
 */
export function buildEmailTransport(
  env: NodeJS.ProcessEnv,
  createTransport: CreateTransport = (opts) => nodemailer.createTransport(opts),
  suppressed?: SuppressionLookup,
): EmailTransport | undefined {
  const host = env['SMTP_HOST']
  const user = env['SMTP_USER']
  const pass = env['SMTP_PASS']
  const from = env['MAIL_FROM']
  if (!host || !user || !pass || !from) return undefined // not fully configured → channel skipped
  const port = Number(env['SMTP_PORT'] ?? '587')
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error('email transport disabled: SMTP_PORT is not a valid port') // no secrets in the log
    return undefined
  }
  const configSet = env['SES_CONFIG_SET']
  // `??` alone only catches undefined: SMTP_TIMEOUT_MS='' → 0 and garbage → NaN, both of which
  // would silently mean "nodemailer default" rather than the bound we intend (same guard shape as
  // main.ts's numeric env parsing)
  const timeoutRaw = Number(env['SMTP_TIMEOUT_MS'])
  const SMTP_TIMEOUT_MS = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 10_000
  // defensive: an options object shouldn't throw on validated primitives, but a bad email config
  // must NEVER crash the worker (it would take the whole pipeline — ingest/trips/geofences — down)
  let mailer: MailSender
  try {
    // TIMEOUTS (audit high): telegram and webpush both bound their sends, email did not — a wedged
    // SMTP socket (half-open NAT, provider throttle) blocked the notify worker's concurrency slot
    // indefinitely and stalled the whole alert queue behind it. nodemailer's three phases each need
    // their own bound; without `socketTimeout` an established-but-silent connection hangs forever.
    mailer = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    })
  } catch {
    console.error('email transport disabled: the SMTP client rejected the configuration') // static, no creds
    return undefined
  }
  return {
    send: async (to, subject, text, html, replyTo) => {
      // A MISSING RECIPIENT IS A NO-OP, NOT A CRASH. `to` is typed `string`, and a job whose payload
      // lost its `email` field made this throw `Cannot read properties of undefined (reading
      // 'split')` — which BullMQ retried five times and then dead-lettered. That is the worst
      // available outcome for a transactional mail: the send is gone, and a TypeError says nothing
      // about which message or whose account. One such corpse sat in the queue for three days.
      if (typeof to !== 'string' || to === '') {
        console.error('email skipped: job carried no recipient') // no payload in the log (PII)
        return
      }
      // drop reserved-TLD recipients before they reach SES (bounce-reputation guard). A comma-list
      // keeps only its deliverable addresses; if none remain the send is a logged no-op, not an error.
      const addressable = to.split(',').map((s) => s.trim()).filter((s) => s !== '' && isDeliverableAddress(s))
      // …and drop the ones SES has told us are dead. Not for the customer's sake — they get nothing
      // either way — but for the sending identity's: bounces are scored account-wide on the one
      // identity that also carries every password reset and activation mail, so an alert rule firing
      // at event rate against a hard-bounced address is a slow way to have SES pause the platform.
      const dead = suppressed === undefined ? new Set<string>() : await suppressed(addressable)
      const deliverable = addressable.filter((a) => !dead.has(a.trim().toLowerCase()))
      if (deliverable.length === 0) {
        console.warn('email skipped: no deliverable recipients (reserved TLD or suppressed)') // count/addresses omitted (PII)
        return
      }
      await mailer.sendMail({
        from,
        // The tenant's own support address, so hitting Reply reaches THEM. Their address was
        // already printed in the footer of every message while the reply went to us — which is
        // both a brand leak and a customer trying to get help from the wrong company.
        ...(replyTo !== undefined && replyTo !== '' ? { replyTo } : {}),
        to: deliverable.join(', '),
        subject,
        text, // always-present plain-text fallback
        // nodemailer sends multipart/alternative when both are present; text is the fallback part
        ...(html ? { html } : {}),
        // route bounces/complaints to the SES config set's SNS destination when configured
        ...(configSet ? { headers: { 'X-SES-CONFIGURATION-SET': configSet } } : {}),
      })
    },
  }
}
