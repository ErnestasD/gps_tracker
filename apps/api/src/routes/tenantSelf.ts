import { randomBytes } from 'node:crypto'
import { resolve4 as dnsResolve4, resolveCname as dnsResolveCname, resolveTxt as dnsResolveTxt } from 'node:dns/promises'

/** DNS TXT resolver — injectable so tests don't hit real DNS. */
export type TxtResolver = (hostname: string) => Promise<string[][]>

export const defaultTxtResolver: TxtResolver = dnsResolveTxt

/** CNAME and A resolvers, for the routing half of the check. Injectable for the same reason. */
export type NameResolver = (hostname: string) => Promise<string[]>

export const defaultCnameResolver: NameResolver = dnsResolveCname
export const defaultAddressResolver: NameResolver = dnsResolve4

/**
 * Where the ownership record goes: a DEDICATED name, `_orbetra-verify.<domain>`, carrying the bare
 * token as its value.
 *
 * It used to be a TXT on the domain itself with the value `orbetra-verify=<token>`, and that could
 * not work alongside the CNAME the same domain needs to reach us: RFC 1034 §3.6.2 forbids a CNAME
 * coexisting with any other record on the same owner name, and Cloudflare and Route 53 enforce it.
 * A tenant who added the CNAME first — which is what the instructions listed first — then could not
 * add the TXT at all, with nothing anywhere to say why. An underscore-prefixed name is the
 * convention precisely because it can never collide with a host (`_dmarc`, `_domainkey`, `_acme-challenge`).
 *
 * It also means the record can stay published forever, so a re-verification later has something to
 * read. The apex form is still accepted — see verifyDomainTxt — because domains added under the old
 * instructions must not stop verifying.
 */
export const TXT_HOST_LABEL = '_orbetra-verify'

/** LEGACY location: a TXT on the domain itself, value `orbetra-verify=<token>`. Still accepted. */
export const TXT_PREFIX = 'orbetra-verify='

/** The hostname the ownership TXT belongs on. */
export function verifyHost(domain: string): string {
  return `${TXT_HOST_LABEL}.${domain}`
}

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

/**
 * Tokens that may not appear ANYWHERE inside a slug, not merely as the whole label.
 *
 * An exact-match list is the wrong shape for an impersonation guard, because the attack does not
 * need the reserved word on its own: `secure-login`, `orbetra-billing`, `account-verify` and
 * `my-account` all passed it, and each would be issued under OUR wildcard certificate on OUR apex.
 * Combined with a `productName` and `logoUrl` a tenant chooses freely, that is a credential page
 * indistinguishable from ours in every visible respect.
 *
 * Deliberately SHORT: every entry costs legitimate names too. These are the words a page asking for
 * a password or a card number uses, plus our own brand; a reseller wanting "acme-support" can have
 * "acme" or "acmefleet", and that trade is worth making on a name we host at our own apex.
 */
const FORBIDDEN_SUBSTRINGS = [
  'account', 'admin', 'auth', 'billing', 'invoice', 'login', 'oauth', 'official', 'passwd',
  'password', 'payment', 'secure', 'signin', 'sso', 'support', 'verify', 'wallet',
]

/** Punycode A-label. `xn--80ak6aa92e` is "аррӏе" in Cyrillic; a homograph passes every ASCII shape
 *  check ever written, so the encoding itself is refused rather than the characters behind it. */
const PUNYCODE_PREFIX = 'xn--'

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
  if (slug.startsWith(PUNYCODE_PREFIX)) return { ok: false, reason: 'that name is reserved' }
  // our own brand anywhere in the name, and the vocabulary of a page that asks for a password
  const brand = root.split('.')[0] ?? ''
  if (brand !== '' && slug.includes(brand)) return { ok: false, reason: 'that name is reserved' }
  if (FORBIDDEN_SUBSTRINGS.some((w) => slug.includes(w))) return { ok: false, reason: 'that name is reserved' }
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
 * Does `hostname` publish a TXT record whose value is exactly `want`?
 *
 * resolveTxt returns CHUNKED records (string[][]) — a value over 255 bytes arrives split, and each
 * record's chunks are joined before comparing. Any lookup error (NXDOMAIN, no TXT) is a false,
 * never a throw: a domain nobody has configured yet is the normal case here, not a fault.
 */
async function txtHas(resolver: TxtResolver, hostname: string, want: string): Promise<boolean> {
  let records: string[][]
  try {
    records = await resolver(hostname)
  } catch {
    return false
  }
  return records.some((chunks) => chunks.join('') === want)
}

/**
 * Verify a domain owns its txtToken.
 *
 * Two accepted locations, checked in the order the UI teaches them:
 *  1. `_orbetra-verify.<domain>` TXT = the bare token — the one we ask for, because it can coexist
 *     with the CNAME the domain also needs (see TXT_HOST_LABEL).
 *  2. `<domain>` TXT = `orbetra-verify=<token>` — what the old instructions asked for. Kept because
 *     a tenant midway through setup, or already verified under it, must not be broken by our
 *     changing our minds.
 */
export async function verifyDomainTxt(resolver: TxtResolver, domain: string, txtToken: string): Promise<boolean> {
  if (await txtHas(resolver, verifyHost(domain), txtToken)) return true
  return txtHas(resolver, domain, expectedTxt(txtToken))
}


/** A hostname with its trailing dot removed and lowercased — DNS is case-insensitive and a
 *  provider may hand back either form. */
function canon(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/** What we found when we looked, and whether it is what we asked for. */
export type DnsCheck = { ok: boolean; found: string[] }

/**
 * Why the routing half failed, when we can tell from DNS alone.
 *
 * `occupied` is the one worth naming: the name already answers with an A or an MX, so it CANNOT
 * hold a CNAME (RFC 1034 §3.6.2) — a CNAME added there is accepted by the provider's panel and
 * silently never served. Without this the panel can only say "not found", and the reader's next
 * move is to re-add the record that was never going to work.
 */
export type RouteReason = 'occupied' | 'elsewhere' | 'absent'

export type DomainDns = {
  /** the ownership TXT — the thing /verify reads */
  txt: DnsCheck
  /** does the name actually REACH us: the CNAME, or an address that matches the edge host */
  route: DnsCheck & { expected: string | null; reason: RouteReason | null }
}

/**
 * Look at a domain's live DNS and report each record separately.
 *
 * Verification used to be one button with two outcomes, so a domain that proved ownership and went
 * nowhere looked exactly like a domain that was finished. That is not hypothetical: a CNAME on a
 * name that already holds A, MX and TXT records is silently dropped by the zone (RFC 1034 §3.6.2),
 * which is a failure with no error anywhere — the panel accepts the record, the zone never serves
 * it, and the tenant is left with a verified badge above a domain that resolves to their old
 * website.
 *
 * The routing half deliberately does NOT insist on a CNAME. A domain root cannot hold one, so an
 * apex has to use ALIAS/ANAME flattening — which publishes an ADDRESS, not a CNAME. What matters
 * is whether the name arrives here, so an address matching the edge host's own counts as reaching
 * us, and `found` carries what was actually seen so the panel can say where it goes instead.
 */
export async function checkDomainDns(
  resolvers: { txt: TxtResolver; cname: NameResolver; address: NameResolver },
  domain: string,
  txtToken: string,
  edgeHostname: string | undefined,
): Promise<DomainDns> {
  const txtFound: string[] = []
  for (const host of [verifyHost(domain), domain]) {
    try {
      for (const chunks of await resolvers.txt(host)) txtFound.push(chunks.join(''))
    } catch {
      // NXDOMAIN / no TXT — a name nobody has configured yet is the normal case here
    }
  }
  const txtOk = txtFound.includes(txtToken) || txtFound.includes(expectedTxt(txtToken))

  const expected = edgeHostname === undefined || edgeHostname.trim() === '' ? null : canon(edgeHostname)
  const routeFound: string[] = []
  let routeOk = false
  let hasCname = false
  let theirAddrs: string[] = []
  if (expected !== null) {
    try {
      const cnames = (await resolvers.cname(domain)).map(canon)
      hasCname = cnames.length > 0
      routeFound.push(...cnames)
      routeOk = cnames.includes(expected)
    } catch {
      /* no CNAME — an apex cannot have one; fall through to addresses */
    }
    if (!routeOk) {
      const [ours, theirs] = await Promise.all([addrs(resolvers.address, expected), addrs(resolvers.address, domain)])
      theirAddrs = theirs
      routeFound.push(...theirs)
      routeOk = theirs.length > 0 && theirs.some((a) => ours.includes(a))
    }
  }

  /**
   * A name that already answers with an address cannot ALSO hold a CNAME, so if there is no CNAME
   * and there are addresses, that is the diagnosis — not "you forgot to add it". Adding it again
   * is what a reader does when told only "not found", and it will be dropped again.
   */
  let reason: RouteReason | null = null
  if (expected !== null && !routeOk) {
    reason = theirAddrs.length > 0 && !hasCname ? 'occupied' : routeFound.length > 0 ? 'elsewhere' : 'absent'
  }

  return {
    txt: { ok: txtOk, found: txtFound },
    route: { ok: routeOk, found: [...new Set(routeFound)], expected, reason },
  }
}

async function addrs(resolve: NameResolver, hostname: string): Promise<string[]> {
  try {
    return await resolve(hostname)
  } catch {
    return []
  }
}


/**
 * The addresses the edge host answers with — what an APEX must be pointed at.
 *
 * A zone root can never hold a CNAME. Not "when other records are in the way": the apex always
 * carries SOA and NS, and RFC 1034 §3.6.2 forbids a CNAME beside any other data, so the record is
 * invalid there by construction. Telling a white-label customer to CNAME their own domain is
 * telling them to do something that cannot be done — and their domain is exactly what they bought
 * white-label for.
 *
 * So the apex gets an A record instead, resolved from the edge host at the moment we hand it over
 * rather than hardcoded. That pins the customer to our address, which is the cost; the alternative
 * every provider that offers it should prefer is ALIAS/ANAME, which flattens a CNAME server-side
 * and keeps the indirection. Both are stated.
 */
export async function edgeAddresses(resolve: NameResolver, edgeHostname: string | undefined): Promise<string[]> {
  if (edgeHostname === undefined || edgeHostname.trim() === '') return []
  return addrs(resolve, canon(edgeHostname))
}
