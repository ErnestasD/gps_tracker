import { Worker, type ConnectionOptions } from 'bullmq'
import type { Pool } from 'pg'

import { brandingSchema, type Branding } from '@orbetra/shared'

import type { EmailTransport } from '../notify/drivers.js'
import { renderResetEmail } from '../notify/passwordResetEmail.js'
import { renderSignupExistsEmail } from '../notify/signupExistsEmail.js'
import { renderVerifyEmail } from '../notify/verifyEmail.js'
import { renderLapseEmail } from '../notify/lapseEmail.js'
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

/**
 * Rewrite a link to land on the TENANT's own host when they have one.
 *
 * Every auth link is built by the API from the single global `APP_BASE_URL`, so a VrummTrack-branded
 * password-reset mail sent its user to `dash.orbetra.com` — where the page resolves as NOT
 * white-labelled and therefore shows the Orbetra wordmark and a link to orbetra.com. The mail kept
 * the promise and the page it opened broke it, on the one screen a reseller's customers are
 * guaranteed to reach.
 *
 * Only the ORIGIN moves. The token lives in the path/query and is validated server-side against the
 * database, so it is origin-independent — and a verified tenant domain serves the same SPA and the
 * same `/v1` through the same Caddy, which is what makes the swap safe rather than merely pretty.
 *
 * Anything unexpected keeps the original link: an unparseable URL, no verified domain, a lookup
 * fault. A mail with a working link to the wrong brand beats a mail with no link at all.
 */
export function onTenantHost(url: string, domain: string | null): string {
  if (domain === null || domain === '') return url
  try {
    const u = new URL(url)
    u.protocol = 'https:' // a verified custom domain always has a cert (Caddy on-demand)
    u.host = domain
    return u.toString()
  } catch {
    return url
  }
}

/** The tenant's own login host: the OLDEST verified domain, so the choice is stable as they add
 *  more. Null when they have none, when the id is not a uuid, or on any fault. */
async function primaryDomain(pool: Pool, tenantId: string): Promise<string | null> {
  if (tenantId === '') return null
  try {
    const res = await pool.query<{ domain: string }>(
      'SELECT domain FROM tenant_domains WHERE "tenantId" = $1 AND verified = true ORDER BY "createdAt" ASC LIMIT 1',
      [tenantId],
    )
    return res.rows[0]?.domain ?? null
  } catch {
    return null
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
  const resolved = await resolveBranding(deps.pool, tenantId)
  // The ACTIVATION mail is the first thing a direct customer ever receives from us, and a self-serve
  // tenant is named after the company they just typed — so `brand = productName ?? tenantName` put
  // the RECIPIENT'S OWN company name in the header of a mail asking them to click a link. That reads
  // like phishing. A real white-label TSP sets `productName`, and that must still win (their end
  // users must never see ours); absent one, this mail is from Orbetra.
  const { branding, tenantName } = resolved
  const brand = job.kind === 'verify-email' ? (branding?.productName?.trim() ?? '') || 'Orbetra' : resolved.brand
  const shellName = job.kind === 'verify-email' ? (branding?.productName?.trim() ?? '') || undefined : tenantName
  // …and send them to THEIR host, not ours. The billing link is deliberately excluded: it is a
  // Stripe portal/checkout return that only makes sense on the platform host.
  const host = await primaryDomain(deps.pool, tenantId)
  const on = (url: string): string => onTenantHost(url, host)
  const { subject, text, html } =
    job.kind === 'signup-exists'
      ? renderSignupExistsEmail({ loginUrl: on(job.loginUrl), resetUrl: on(job.resetUrl), locale: job.locale, brand, branding, tenantName })
      : job.kind === 'lapse'
        ? renderLapseEmail({ billingUrl: job.billingUrl, daysLeft: job.daysLeft, locale: job.locale, brand, branding, tenantName })
        : job.kind === 'verify-email'
        ? renderVerifyEmail({ verifyUrl: on(job.verifyUrl), expiresHours: job.expiresHours, locale: job.locale, brand, branding, tenantName: shellName })
        : renderResetEmail({ resetUrl: on(job.resetUrl), expiresMinutes: job.expiresMinutes, locale: job.locale, brand, branding, tenantName })
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
