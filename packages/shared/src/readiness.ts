import { whiteLabelFromPlan } from './plans.js'

/**
 * Is a reseller's workspace ready to be shown to THEIR customers?
 *
 * The founder's framing, and the reason this exists: a TSP account is only truly set up once the
 * customer has finished configuring it — only then do we know what name to send mail from, which
 * logo to show and which links to embed. Until now that state did not exist in the product, so a
 * half-configured reseller went on serving customers while the platform silently supplied the
 * missing halves from its own identity. The 2026-09 white-label audit found thirteen instances.
 *
 * ── What this gates, and what it deliberately does not ───────────────────────────────────────────
 * It gates the FIRST ACTION THAT CREATES AN AUDIENCE — a sub-account, a user invitation, a public
 * share link. Not signing in, not configuring, not importing devices. A leak needs somebody to leak
 * to; while a reseller has no customers there is nothing to protect, and locking them out of the
 * screens where the configuration is entered would be a circular product.
 *
 * ── Two kinds of missing ─────────────────────────────────────────────────────────────────────────
 * `hardBlockers` are the ones where a customer would objectively see the wrong identity. Only a
 * verified host is one today: without it there is no address their customers can reach at all.
 * `softHints` are quality — no logo means we show their name as text, which is plain but never ours.
 * Blocking on a missing logo would cost real anger and buy no protection, so it does not.
 *
 * ── Not for Direct customers ─────────────────────────────────────────────────────────────────────
 * Only tenants holding the `whiteLabel` entitlement are gated. For a `direct_*` tenant our brand is
 * the correct brand — they bought OUR product — and gating them would lock paying customers out of
 * creating accounts for no reason at all.
 */

/** How this tenant is reachable — which decides how much configuration "done" means. */
export type ReadinessMode =
  /** not a reseller (no `whiteLabel` entitlement) — our brand is correct and nothing is gated */
  | 'not_white_label'
  /** on `<slug>.<platformDomain>`: they accepted a shared host, so they are ready immediately */
  | 'platform_subdomain'
  /** on a domain they own and verified — full white-label */
  | 'own_domain'
  /** a reseller with no verified host at all — the state this model exists to name */
  | 'unconfigured'

export type ReadinessBlocker = 'no_verified_domain'
export type ReadinessHint = 'product_name' | 'logo' | 'favicon' | 'support_email' | 'colors' | 'own_domain'

export interface Readiness {
  mode: ReadinessMode
  /** may this tenant create a customer-facing audience? */
  ready: boolean
  /** must be resolved before customers exist — each maps to a translated line in the UI */
  hardBlockers: ReadinessBlocker[]
  /** worth doing, never blocking */
  softHints: ReadinessHint[]
}

export interface ReadinessInput {
  plan: string | null | undefined
  branding: { productName?: string | undefined; logoUrl?: string | undefined; faviconUrl?: string | undefined; supportEmail?: string | undefined; primary?: string | undefined }
  /** the tenant's domains, as `tenant_domains` holds them */
  domains: readonly { domain: string; verified: boolean }[]
  /** `PLATFORM_DOMAIN`; absent ⇒ the subdomain option is not offered, so no domain can be one */
  platformDomain?: string | undefined
}

/**
 * Is `domain` inside the platform's own DNS zone — the apex itself, or any name under it?
 *
 * Two things need this answer and they must never disagree: the API, to route a domain to the
 * subdomain path (we own the zone, so there is no TXT for the tenant to publish), and readiness, to
 * tell a tenant sitting on OUR hostname apart from one on their own. It lived in both places for a
 * while and the copies drifted — the readiness copy dropped the `.trim()`, and `main.ts` passes
 * `process.env['PLATFORM_DOMAIN']` through untouched. One trailing space in the deployed environment
 * and a tenant on `acme.orbetra.com` would have been classified as being on their own domain, and so
 * never told to move off ours. One function, called from both.
 *
 * `.trim()` because it comes from an environment variable; both sides lowercased because DNS is
 * case-insensitive and only one of the two call sites normalizes its input.
 */
export function isUnderPlatformDomain(domain: string, platformDomain: string | undefined): boolean {
  if (platformDomain === undefined || platformDomain.trim() === '') return false
  const root = platformDomain.trim().toLowerCase()
  const d = domain.trim().toLowerCase()
  return d === root || d.endsWith(`.${root}`)
}

const filled = (v: string | undefined): boolean => v !== undefined && v.trim() !== ''

export function whiteLabelReadiness(input: ReadinessInput): Readiness {
  // `=== false` and not `!x`: an UNREADABLE plan is not a licence to gate. `whiteLabelFromPlan`
  // answers undefined when it cannot read the column, and treating that as "not a reseller" would
  // silently un-gate a real one; treating it as "is a reseller" would lock a Direct customer out of
  // creating accounts. Unknown falls through to the domain check, which is the harmless direction:
  // a tenant with a verified host is ready either way.
  if (whiteLabelFromPlan(input.plan) === false) {
    return { mode: 'not_white_label', ready: true, hardBlockers: [], softHints: [] }
  }

  const verified = input.domains.filter((d) => d.verified)
  const own = verified.filter((d) => !isUnderPlatformDomain(d.domain, input.platformDomain))
  const b = input.branding

  const softHints: ReadinessHint[] = []
  if (!filled(b.productName)) softHints.push('product_name')
  if (!filled(b.logoUrl)) softHints.push('logo')
  // only worth mentioning once they HAVE a logo — until then "add a favicon" is noise, and an unset
  // favicon falls back to the logo by design
  if (filled(b.logoUrl) && !filled(b.faviconUrl)) softHints.push('favicon')
  if (!filled(b.supportEmail)) softHints.push('support_email')
  if (!filled(b.primary)) softHints.push('colors')

  if (verified.length === 0) {
    return { mode: 'unconfigured', ready: false, hardBlockers: ['no_verified_domain'], softHints }
  }
  if (own.length === 0) {
    // They chose the zero-setup path with their eyes open: `<slug>.<platformDomain>` is offered as
    // "works immediately", and their customers will see that hostname. Ready — but still told that
    // their own domain is the thing that finishes the job.
    return { mode: 'platform_subdomain', ready: true, hardBlockers: [], softHints: [...softHints, 'own_domain'] }
  }
  return { mode: 'own_domain', ready: true, hardBlockers: [], softHints }
}
