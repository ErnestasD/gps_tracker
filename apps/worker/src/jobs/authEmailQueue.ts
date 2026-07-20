import { Queue, type ConnectionOptions } from 'bullmq'

/**
 * Transactional auth-email queue (ADR-031). The API cannot send email (the SES/SMTP transport
 * lives in the worker), so it enqueues here and the worker renders the tenant-branded message and
 * sends it. Today the only kind is `password-reset`; the shape leaves room for future auth mails
 * (email verification, admin-invite) without a new queue.
 *
 * The raw reset token never rides this queue — the API bakes it into `resetUrl` and passes only the
 * finished link, so the secret is confined to the DB (hashed) and the one email.
 */
export const AUTH_EMAIL_QUEUE = 'auth-email'

export interface AuthEmailJob {
  kind: 'password-reset'
  /** recipient address (the account's login email) */
  email: string
  /** owning tenant — resolves the white-label branding for the message shell */
  tenantId: string
  /** recipient locale (en|lt|de|pl); falls back to en for anything else */
  locale: string
  /** the full, ready-to-click reset link (APP_BASE_URL + /reset-password?token=…) */
  resetUrl: string
  /** link lifetime in minutes, shown in the body */
  expiresMinutes: number
}

export function createAuthEmailQueue(connection: ConnectionOptions): Queue<AuthEmailJob> {
  return new Queue<AuthEmailJob>(AUTH_EMAIL_QUEUE, { connection })
}

/**
 * Enqueue a password-reset email. No custom jobId: two legitimate reset requests for the same email
 * are DISTINCT sends (each carries its own single-use token), so they must not collapse. Bounded
 * retries with backoff cover a transient SMTP blip; a permanently-failing job is dropped
 * (removeOnFail) so it can't wedge the queue.
 */
export async function enqueueAuthEmail(queue: Queue<AuthEmailJob>, job: AuthEmailJob): Promise<void> {
  await queue.add('auth-email', job, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 500,
  })
}
