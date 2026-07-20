import { Worker, type ConnectionOptions } from 'bullmq'
import type { Pool } from 'pg'

import { brandingSchema, type Branding } from '@orbetra/shared'

import type { EmailTransport } from '../notify/drivers.js'
import { renderResetEmail } from '../notify/passwordResetEmail.js'
import { AUTH_EMAIL_QUEUE, type AuthEmailJob } from './authEmailQueue.js'

export interface AuthEmailWorkerDeps {
  connection: ConnectionOptions
  pool: Pool
  /** SES/SMTP transport (buildEmailTransport). Absent ⇒ email not configured: the job is a no-op
   *  (channel skipped, same env-gating as every other driver) — NOT a retryable failure. */
  transport?: EmailTransport | undefined
  onSent?: (kind: string) => void
}

/** The tenant's white-label identity for a transactional email (mirrors scheduledReporter): the
 *  outgoing `brand` string plus the full branding + tenant name for the branded shell. Any
 *  lookup/parse failure defaults gracefully so a missing brand never suppresses delivery. */
async function resolveBranding(pool: Pool, tenantId: string): Promise<{ brand: string; branding: Branding | undefined; tenantName: string | undefined }> {
  try {
    const res = await pool.query<{ name: string; branding: unknown }>('SELECT name, branding FROM tenants WHERE id = $1', [tenantId])
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
  const { brand, branding, tenantName } = await resolveBranding(deps.pool, job.tenantId)
  const { subject, text, html } = renderResetEmail({
    resetUrl: job.resetUrl,
    expiresMinutes: job.expiresMinutes,
    locale: job.locale,
    brand,
    branding,
    tenantName,
  })
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
