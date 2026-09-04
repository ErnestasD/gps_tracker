import type { Pool } from '@orbetra/db'

/**
 * Which host a tenant's mail should point at — for links, and now for images.
 *
 * This rule already existed, inline in authEmailWorker, because auth links had to land on the
 * tenant's own domain. Uploaded brand images need exactly the same answer: `branding.logoUrl` may be
 * a RELATIVE path (`/v1/public/brand/…`), which a browser resolves against the page it is on and a
 * mail client cannot resolve at all. So the rule is lifted here and both callers share one
 * definition rather than drifting apart.
 */

/** The tenant's own host: the OLDEST verified domain, so the choice is stable as they add more.
 *  Null when they have none, when the id is not a uuid, or on any fault. */
export async function primaryDomain(pool: Pool, tenantId: string): Promise<string | null> {
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

/**
 * The absolute origin an uploaded brand image is reachable at, for THIS tenant.
 *
 * A tenant with a verified domain gets their own, which is the entire point: a reseller's customer
 * opens the mail and the logo comes from the same host as everything else they see.
 *
 * A tenant WITHOUT one falls back to the platform host, and that is not a new leak — a tenant with
 * no verified domain already receives auth links on the platform host (`onTenantHost` returns the
 * URL unchanged for them), because there is nowhere else for those links to go. They are not
 * white-labelled in any customer-visible way yet.
 *
 * Returns null when neither is known, which renders as the text wordmark rather than a broken image.
 */
export async function brandAssetOrigin(pool: Pool, tenantId: string, appBaseUrl: string | undefined): Promise<string | null> {
  const domain = await primaryDomain(pool, tenantId)
  if (domain !== null) return `https://${domain}`
  if (appBaseUrl === undefined || appBaseUrl === '') return null
  try {
    return new URL(appBaseUrl).origin
  } catch {
    return null
  }
}
