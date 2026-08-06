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

/** Fields every auth mail carries. */
interface AuthEmailBase {
  /** recipient address (the account's login email) */
  email: string
  /** owning tenant — resolves the white-label branding for the message shell */
  tenantId: string
  /** recipient locale (en|lt|de|pl); falls back to en for anything else */
  locale: string
}

export interface PasswordResetEmailJob extends AuthEmailBase {
  kind: 'password-reset'
  /** the full, ready-to-click reset link (APP_BASE_URL + /reset-password?token=…) */
  resetUrl: string
  /** link lifetime in minutes, shown in the body */
  expiresMinutes: number
}

/**
 * "Someone tried to sign up with your address" (audit MED #67). Public signup answers a duplicate
 * email with the SAME 201 as a real one — the fact that the address is taken is delivered here, to
 * the only person entitled to know it. Carries no token and nothing the attempt supplied.
 */
export interface SignupExistsEmailJob extends AuthEmailBase {
  kind: 'signup-exists'
  loginUrl: string
  resetUrl: string
}

/**
 * The mail that ACTIVATES a self-serve signup (audit MED #67). Until its link is clicked the account
 * cannot authenticate, which is what stops signup's free branch from answering "does this address
 * exist" through a follow-up login.
 */
export interface VerifyEmailJob extends AuthEmailBase {
  kind: 'verify-email'
  verifyUrl: string
  expiresHours: number
}

/**
 * A step on the lapse ladder (audit MED #22): three warnings, then the notice that the fleet stopped
 * reporting. `daysLeft: 0` is the suspension notice. Same queue as the other transactional mail —
 * one worker, one branded shell, one place where a send can fail.
 */
export interface LapseEmailJob extends AuthEmailBase {
  kind: 'lapse'
  billingUrl: string
  daysLeft: number
}

export type AuthEmailJob = PasswordResetEmailJob | SignupExistsEmailJob | VerifyEmailJob | LapseEmailJob

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
