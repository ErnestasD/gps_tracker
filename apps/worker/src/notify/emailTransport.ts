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
  sendMail(opts: { from: string; to: string; subject: string; text: string; headers?: Record<string, string> }): Promise<unknown>
}
export interface SmtpOptions {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
}
type CreateTransport = (opts: SmtpOptions) => MailSender

export function buildEmailTransport(
  env: NodeJS.ProcessEnv,
  createTransport: CreateTransport = (opts) => nodemailer.createTransport(opts),
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
  // defensive: an options object shouldn't throw on validated primitives, but a bad email config
  // must NEVER crash the worker (it would take the whole pipeline — ingest/trips/geofences — down)
  let mailer: MailSender
  try {
    mailer = createTransport({ host, port, secure: port === 465, auth: { user, pass } })
  } catch {
    console.error('email transport disabled: the SMTP client rejected the configuration') // static, no creds
    return undefined
  }
  return {
    send: async (to, subject, text) => {
      await mailer.sendMail({
        from,
        to,
        subject,
        text,
        // route bounces/complaints to the SES config set's SNS destination when configured
        ...(configSet ? { headers: { 'X-SES-CONFIGURATION-SET': configSet } } : {}),
      })
    },
  }
}
