import { randomBytes } from 'node:crypto'
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises'

/** DNS TXT resolver — injectable so tests don't hit real DNS. */
export type TxtResolver = (hostname: string) => Promise<string[][]>

export const defaultTxtResolver: TxtResolver = dnsResolveTxt

export const TXT_PREFIX = 'orbetra-verify='

/** New CSPRNG verification token (hex). */
export function newTxtToken(): string {
  return randomBytes(16).toString('hex')
}

/** The exact TXT record value the tenant must publish. */
export function expectedTxt(txtToken: string): string {
  return `${TXT_PREFIX}${txtToken}`
}

/**
 * Labels nobody may claim under OUR domain.
 *
 * A platform subdomain skips DNS proof (we own the zone — there is nothing for a tenant to prove),
 * so this list is the ENTIRE ownership check. It has to cover three separate hazards, not just the
 * hosts that exist today:
 *  - our own hostnames, present and future (`dash`, `www`, `api`, `staging`, the monitoring stack);
 *  - names that let a tenant impersonate the platform to their own customers (`billing`, `secure`,
 *    `account`, `login`) — a phishing page on `secure.orbetra.com` carries OUR certificate;
 *  - mail and well-known infrastructure labels (`mx`, `smtp`, `autodiscover`, `hello` — the SES
 *    bounce subdomain), where a claimed name would also never work: a wildcard is skipped for any
 *    name that already has a record of its own (RFC 4592), so such a claim resolves to nothing and
 *    the tenant would be left with a verified domain that is permanently dark.
 */
const RESERVED_LABELS = new Set([
  'admin', 'api', 'app', 'apps', 'account', 'accounts', 'assets', 'auth', 'autodiscover', 'autoconfig',
  'billing', 'blog', 'cdn', 'dash', 'dashboard', 'demo', 'dev', 'docs', 'files', 'ftp', 'grafana',
  'hello', 'help', 'imap', 'ingest', 'internal', 'login', 'mail', 'mx', 'ns', 'ns1', 'ns2', 'ns3', 'partner',
  'partners', 'pop', 'prometheus', 'prod', 'secure', 'signup', 'smtp', 'staging', 'static', 'status',
  'support', 'test', 'webmail', 'www',
])

/** Slug rules for a platform subdomain: a single DNS label, 3–40 chars, no leading/trailing dash. */
const SLUG_RE = /^(?!-)[a-z0-9-]{3,40}(?<!-)$/

export interface PlatformSubdomainCheck {
  /** true when `domain` is `<slug>.<platformDomain>` and the slug is claimable */
  ok: boolean
  /** why not — a message the API hands back verbatim */
  reason?: string
}

/**
 * Is `domain` a claimable subdomain of the platform's own domain?
 *
 * A tenant that owns no domain (or cannot get DNS changed this quarter) still needs somewhere for
 * their customers to log in, so `<slug>.orbetra.com` is offered as the zero-setup option. We control
 * that zone, which is exactly why it must be checked HERE rather than by the DNS-TXT flow: asking a
 * tenant to publish a TXT record in our zone is impossible, so skipping the proof is correct — and
 * makes this function the only thing standing between a tenant and `secure.orbetra.com`.
 *
 * Returns a REASON rather than a bare false so the operator learns which rule they hit; "that name is
 * reserved" and "3–40 characters" are different problems and a single 400 hides which.
 */
export function checkPlatformSubdomain(domain: string, platformDomain: string | undefined): PlatformSubdomainCheck {
  if (platformDomain === undefined || platformDomain.trim() === '') return { ok: false, reason: 'platform subdomains are not configured' }
  const root = platformDomain.trim().toLowerCase()
  const suffix = `.${root}`
  if (domain === root) return { ok: false, reason: 'that is the platform domain itself' }
  if (!domain.endsWith(suffix)) return { ok: false, reason: `must end in ${suffix}` }
  const slug = domain.slice(0, -suffix.length)
  // exactly ONE label: `a.b.orbetra.com` would need a wildcard cert one level deeper than the
  // `*.orbetra.com` record this feature assumes, so it would resolve and then fail TLS
  if (slug.includes('.')) return { ok: false, reason: 'only one level is allowed (name.' + root + ')' }
  // RESERVED before SHAPE: several reserved labels are shorter than the minimum (`mx`, `ns`), and
  // "use 3–40 characters" would send someone off to try `mx01` instead of telling them the real rule
  if (RESERVED_LABELS.has(slug)) return { ok: false, reason: 'that name is reserved' }
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'use 3–40 characters: letters, digits and dashes' }
  return { ok: true }
}

/** True when this domain is under the platform's own zone at all — claimable or not. Used to route
 *  a request to the subdomain path so a RESERVED name is refused rather than sent off to publish a
 *  TXT record in a zone they do not control (which would never verify, with no explanation). */
export function isUnderPlatformDomain(domain: string, platformDomain: string | undefined): boolean {
  if (platformDomain === undefined || platformDomain.trim() === '') return false
  const root = platformDomain.trim().toLowerCase()
  return domain === root || domain.endsWith(`.${root}`)
}

/**
 * Verify a domain owns its txtToken via a DNS TXT lookup. resolveTxt returns
 * chunked records (string[][]) — each record's chunks are joined. Any lookup
 * error (NXDOMAIN, no TXT) → false, never throws.
 */
export async function verifyDomainTxt(resolver: TxtResolver, domain: string, txtToken: string): Promise<boolean> {
  let records: string[][]
  try {
    records = await resolver(domain)
  } catch {
    return false
  }
  const want = expectedTxt(txtToken)
  return records.some((chunks) => chunks.join('') === want)
}
