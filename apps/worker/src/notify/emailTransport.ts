import nodemailer from 'nodemailer'

import type { EmailTransport } from './drivers.js'

/**
 * Concrete SMTP e-mail transport (E05-5, ADR-023). Reads the runbook's env contract
 * (docs/runbooks/aws-ses-setup.md §6) verbatim:
 *   SMTP_URL  = smtp://<user>:<pass>@email-smtp.eu-central-1.amazonaws.com:587
 *   MAIL_FROM = alerts@<domain>            (a DKIM-verified SES identity)
 *   SES_CONFIG_SET (optional)             = the SES configuration set for bounce/complaint routing
 * Env-gated like every driver: absent SMTP_URL/MAIL_FROM ⇒ returns undefined ⇒ the email channel
 * is SKIPPED (a config gap, not a retryable failure). Secrets live only in the server .env (rule 12).
 *
 * `createTransport` is injectable so tests exercise the send mapping without a live SMTP server.
 */
export interface MailSender {
  sendMail(opts: { from: string; to: string; subject: string; text: string; headers?: Record<string, string> }): Promise<unknown>
}
type CreateTransport = (url: string) => MailSender

export function buildEmailTransport(
  env: NodeJS.ProcessEnv,
  createTransport: CreateTransport = (url) => nodemailer.createTransport(url),
): EmailTransport | undefined {
  const url = env['SMTP_URL']
  const from = env['MAIL_FROM']
  if (!url || !from) return undefined // not configured → channel skipped
  const configSet = env['SES_CONFIG_SET']
  // A MALFORMED SMTP_URL must NOT crash the worker at startup — that would take the whole pipeline
  // (ingest consumers, trips, geofences) down over an email misconfig. Fall back to "skipped".
  let mailer: MailSender
  try {
    mailer = createTransport(url)
  } catch {
    // NEVER log the error/URL — a URL-parse error can echo the SMTP password (rule 12). Static only.
    console.error('email transport disabled: SMTP_URL was rejected by the SMTP client')
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
