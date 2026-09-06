import type { Pool } from '@orbetra/db'

/**
 * Which host a tenant's mail should point at — for links, and for images.
 *
 * This rule already existed, inline in authEmailWorker, because auth links had to land on the
 * tenant's own domain. Uploaded brand images need exactly the same answer: `branding.logoUrl` may be
 * a RELATIVE path (`/v1/public/brand/…`), which a browser resolves against the page it is on and a
 * mail client cannot resolve at all. So the rule lives here once rather than drifting apart.
 */

/**
 * The tenant's own host: their OWN domain first, and only then a `<slug>.<PLATFORM_DOMAIN>` one.
 *
 * The rule used to be "oldest verified domain, so the choice is stable as they add more". Stability
 * is right, but a platform subdomain is created **already verified** (there is no ownership for the
 * tenant to prove in our own zone), so it is always the OLDEST — and the onboarding order the
 * product itself teaches is "take the instant subdomain now, do DNS later". The tenant's real domain
 * could therefore never win, and their customers browsed `track.reseller.lt` all day and then got a
 * password-reset mail whose visible link read `https://reseller.orbetra.com/…` — permanently, since
 * `createdAt` never changes (audit W-5).
 *
 * It hid well: the subdomain IS a verified tenant domain, so the page that opens renders correctly
 * white-labelled. The leak is the hostname alone, and it is visible in both MIME parts, so nothing
 * depends on a click.
 *
 * Ranking, not exclusion: a tenant whose ONLY host is the platform subdomain still gets it — that is
 * the zero-setup option working as sold. Within each group the oldest still wins, which is what
 * keeps the choice stable as a tenant adds more of their own domains.
 *
 * `platformDomain` empty/absent ⇒ pure oldest-wins, the previous behaviour.
 */
export async function primaryDomain(pool: Pool, tenantId: string, platformDomain?: string): Promise<string | null> {
  if (tenantId === '') return null
  try {
    const res = await pool.query<{ domain: string }>(
      // `right(domain, length($2) + 1) = '.' || $2` rather than LIKE: an exact suffix comparison
      // needs no escaping, where a LIKE pattern would treat `_` and `%` in the configured domain as
      // wildcards. `$2 = ''` short-circuits the whole ranking to the old behaviour.
      `SELECT domain FROM tenant_domains
        WHERE "tenantId" = $1 AND verified = true
        ORDER BY (CASE WHEN $2 <> '' AND right(domain, length($2) + 1) = '.' || $2 THEN 1 ELSE 0 END) ASC,
                 "createdAt" ASC
        LIMIT 1`,
      [tenantId, platformDomain ?? ''],
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
 * `platformOrigin` is the fallback for a tenant with NO verified domain, and it is deliberately a
 * per-caller argument rather than something this function reaches for on its own (audit W-6). It is
 * only defensible where the SAME message already shows the platform host somewhere else — auth mail,
 * whose visible button points there because a tenant without a verified domain has no host of their
 * own for a link to go to. In a mail that carries no URL at all — an alert, a scheduled report — the
 * image URL would be the only thing naming us, and a report's recipients are a free-text address
 * list, so a recipient may have no other sight of our host whatsoever.
 *
 * Null ⇒ no absolute origin, so `safeHttpsUrl` drops the relative path and the header renders the
 * product name as text. A missing logo, never a broken one, and never someone else's host.
 */
export async function brandAssetOrigin(
  pool: Pool,
  tenantId: string,
  opts: { platformDomain?: string | undefined; platformOrigin?: string | undefined } = {},
): Promise<string | null> {
  const domain = await primaryDomain(pool, tenantId, opts.platformDomain)
  if (domain !== null) return `https://${domain}`
  if (opts.platformOrigin === undefined || opts.platformOrigin === '') return null
  try {
    return new URL(opts.platformOrigin).origin
  } catch {
    return null
  }
}
