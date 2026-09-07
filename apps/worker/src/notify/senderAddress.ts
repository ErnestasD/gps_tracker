import type { Pool } from '@orbetra/db'

/**
 * The address this tenant's mail should go out AS (ADR-036, audit W-3).
 *
 * The sibling of `primaryDomain` in tenantOrigin.ts, and read the same way and for the same reason:
 * the worker resolves a tenant's mail identity from the pool at send time rather than carrying it
 * through the job payload, so a domain verified after a job was enqueued is still honoured.
 *
 * ── Reads verifiedAt, never status ───────────────────────────────────────────────────────────────
 * `status` is what the settings screen shows the tenant; `verifiedAt` is whether SES has actually
 * authorised us to sign as that domain. They come apart on purpose: a previously verified identity
 * whose last GetEmailIdentity call came back unhappy is marked `failed` for the tenant to see, while
 * its DKIM records are still published and still working. Reverting that tenant to OUR From line —
 * silently, on a transient API answer — would be the leak this whole feature exists to close.
 *
 * ── Null is the correct answer, not a degraded one ───────────────────────────────────────────────
 * A tenant with no verified sending domain sends on the platform identity. That is a smaller problem
 * than the alternative: mail sent as a domain that has NOT signed for us fails DMARC and lands in
 * spam, so a customer stops receiving the alert that their vehicle moved. Unverified must never
 * become unsent.
 *
 * Fails to null on a query fault, for the same reason.
 */
export async function sendingAddress(pool: Pool, tenantId: string): Promise<string | null> {
  if (tenantId === '') return null
  try {
    const res = await pool.query<{ address: string }>(
      `SELECT mailbox || '@' || domain AS address
         FROM tenant_sending_domains
        WHERE "tenantId" = $1 AND "verifiedAt" IS NOT NULL
        LIMIT 1`,
      [tenantId],
    )
    return res.rows[0]?.address ?? null
  } catch (err) {
    console.error('sending address lookup failed for tenant', tenantId, err instanceof Error ? err.message : String(err))
    return null
  }
}
