import { Worker, type ConnectionOptions } from 'bullmq'
import type { Pool } from 'pg'

import { brandingSchema, type Branding } from '@orbetra/shared'

import type { EmailTransport } from '../notify/drivers.js'
import { renderResetEmail } from '../notify/passwordResetEmail.js'
import { renderSignupExistsEmail } from '../notify/signupExistsEmail.js'
import { AUTH_EMAIL_QUEUE, type AuthEmailJob } from './authEmailQueue.js'

export interface AuthEmailWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  /** SES/SMTP transport (buildEmailTransport). Absent ⇒ email not configured: the job is a no-op
   *  (channel skipped, same env-gating as every other driver) — NOT a retryable failure. */
  transport?: EmailTransport | undefined
  onSent?: (kind: string) => void
}

/**
 * The tenant that owns a login address, for a job that could not resolve it on the API side.
 *
 * `findFirst`-shaped on purpose: an address is unique platform-wide by signup's own rule, and if
 * that were ever violated the first match is still a tenant the recipient belongs to. Returns '' on
 * a miss or a fault, which `resolveBranding` turns into the default brand rather than no mail.
 */
async function tenantIdForEmail(pool: Pool, email: string): Promise<string> {
  try {
    const res = await pool.query<{ tenantId: string }>('SELECT "tenantId" FROM users WHERE email = $1 LIMIT 1', [email])
    return res.rows[0]?.tenantId ?? ''
  } catch {
    return ''
  }
}

/** The tenant's white-label identity for a transactional email (mirrors scheduledReporter): the
 *  outgoing `brand` string plus the full branding + tenant name for the branded shell. Any
 *  lookup/parse failure defaults gracefully so a missing brand never suppresses delivery. */
async function resolveBranding(pool: Pool, tenantId: string): Promise<{ brand: string; branding: Branding | undefined; tenantName: string | undefined }> {
  try {
    // `id = ''` is a 22P02 (invalid uuid), not an empty result — cheaper and clearer to skip the
    // query than to catch a syntax error on every default-branded send
    if (tenantId === '') return { brand: 'Orbetra', branding: undefined, tenantName: undefined }
    const res = await pool.query<{ name: string; branding: unknown }>('SELECT name, branding FROM tenants WHERE id = $1::uuid', [tenantId])
    const row = res.rows[0]
    if (row === undefined) return { brand: 'Orbetra', branding: undefined, tenantName: undefined }
    const tenantName = row.name && row.name.trim() !== '' ? row.name : undefined
    const parsed = row.branding && typeof row.branding === 'object' ? brandingSchema.safeParse(row.branding) : undefined
    const branding = parsed?.success ? parsed.data : undefined
    const product = branding?.productName
    const brand = typeof product === 'string' && product.trim() !== '' ? product : tenantName ?? 'Orbetra'
    return { brand, branding, tenantName }
  } catch {
    return { brand: 'Orbetra', branding: undefined, tenantName: undefined }
  }
}

/** Render + send one auth email. Exported for unit testing without a live queue. */
export async function sendAuthEmail(deps: Pick<AuthEmailWorkerDeps, 'pool' | 'transport'>, job: AuthEmailJob): Promise<boolean> {
  if (deps.transport === undefined) {
    console.warn('auth-email skipped: email transport not configured') // no address in the log (PII)
    return false
  }
  // An empty tenantId means "resolve it here" — the signup-exists mail cannot look the tenant up on
  // the API side without putting a query on the taken path that the free path does not have, which
  // is the timing signal the whole change exists to remove. The worker is already off the request
  // path. Doing it here is also what keeps white-label intact: a TSP's end user must not receive an
  // Orbetra-branded mail naming their supplier. A miss falls back to the default brand.
  const tenantId = job.tenantId !== '' ? job.tenantId : await tenantIdForEmail(deps.pool, job.email)
  const { brand, branding, tenantName } = await resolveBranding(deps.pool, tenantId)
  const { subject, text, html } =
    job.kind === 'signup-exists'
      ? renderSignupExistsEmail({ loginUrl: job.loginUrl, resetUrl: job.resetUrl, locale: job.locale, brand, branding, tenantName })
      : renderResetEmail({ resetUrl: job.resetUrl, expiresMinutes: job.expiresMinutes, locale: job.locale, brand, branding, tenantName })
  await deps.transport.send(job.email, subject, text, html)
  return true
}

/** BullMQ worker: render the tenant-branded auth email and send it. concurrency 4 (I/O-bound SMTP). */
export function startAuthEmailWorker(deps: AuthEmailWorkerDeps): Worker<AuthEmailJob> {
  return new Worker<AuthEmailJob>(
    AUTH_EMAIL_QUEUE,
    async (job) => {
      const sent = await sendAuthEmail(deps, job.data)
      if (sent) deps.onSent?.(job.data.kind)
    },
    { connection: deps.connection, concurrency: 4 },
  )
}
