import { Hono } from 'hono'
import type { Redis } from 'ioredis'

import { hashShareToken, readLatestValidPosition, type Db, type Pool } from '@orbetra/db'
import { brandingReadSchema, type PublicShareView } from '@orbetra/shared'

import { problem } from '../auth/middleware.js'
import { clientIp } from '../net.js'

// atomic fixed-window (mirrors pilotRequest): INCR, set TTL on first hit OR re-arm a stranded
// TTL-less key — never leaves a key that would 429 forever (review LOW-2)
const RL_SCRIPT = `local n = redis.call('INCR', KEYS[1])
if n == 1 or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`

/**
 * PUBLIC white-label endpoints (E03-5) — registered BEFORE the /v1/* auth
 * middleware (Caddy and pre-login browsers have no bearer token):
 *  - GET /v1/internal/caddy-ask?domain=  — Caddy on-demand-TLS gate: 200 iff the
 *    domain is a VERIFIED tenant_domain, else 403. Throttled PER DOMAIN (not per IP):
 *    every ask arrives from Caddy's own IP, so an IP bucket would be one global bucket
 *    an attacker could exhaust via many distinct SNIs. Keying on the requested domain
 *    bounds retries for any single domain without a shared choke point. Caddy's own
 *    on_demand_tls interval/burst is the coarse global bound.
 *  - GET /v1/branding  — branding for the requesting Host (custom domain) so the
 *    login screen shows the tenant's logo/colors before auth; unknown host → {}.
 */
/** The parts of the manifest that are not brand-dependent, plus OUR values for the parts that are. */
const PLATFORM_MANIFEST = {
  name: 'Orbetra',
  description: 'Live GPS fleet tracking',
  start_url: '/app/map',
  scope: '/',
  display: 'standalone',
  background_color: '#0B1020',
  theme_color: '#0B1020',
  icons: [
    { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

export interface PublicDeps {
  db: Db
  redis: Redis
  askRateLimit: { max: number; windowS: number }
  /** raw-SQL pool for the public share endpoint's latest-position read; absent ⇒ share 503s. */
  pool?: Pool
  /** public share-resolve rate limit — PER CLIENT IP (review MED): a per-token bucket both
   *  fails to bound a distinct-token flood AND lets one viewer starve every other viewer of the
   *  same link. Keyed on the real client IP so legitimate fan-out (each viewer its own IP) is
   *  unaffected while one abusive IP is capped. Default 300/min. */
  shareRateLimit: { max: number; windowS: number }
  getRemoteAddr: (c: unknown) => string
  trustProxy: boolean
}

const isHostname = (s: string): boolean =>
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(s)

export function createPublicRoutes(deps: PublicDeps): Hono {
  const app = new Hono()

  app.get('/v1/internal/caddy-ask', async (c) => {
    // INTERNAL ONLY. Caddy calls this DIRECTLY over the compose network
    // (`ask http://api:3010/v1/internal/caddy-ask`), so the request carries no proxy headers. Any
    // request that DID come through the proxy is by definition from the internet and must not be
    // served: this route is unauthenticated by design and its throttle is keyed on the REQUESTED
    // DOMAIN, so a stranger sending 10 requests/min for someone else's white-label hostname makes
    // it 429 — and Caddy reads any non-2xx ask as "deny", so that tenant's certificate stops being
    // issued or renewed. The 200/403 split is also an oracle for which hostnames are verified.
    // The Caddyfile 404s /v1/internal/* at every public host block; this is the second lock, so a
    // future host block that forgets it does not silently re-open the same door. Audit high.
    if (c.req.header('x-forwarded-for') !== undefined || c.req.header('x-forwarded-host') !== undefined) {
      return c.notFound()
    }
    const domain = (c.req.query('domain') ?? '').toLowerCase()
    if (!isHostname(domain)) return c.text('bad domain', 400)
    // rate-limit per DOMAIN (fixed window, ATOMIC re-arm) — a stranded TTL-less key would else
    // 429 this domain forever and Caddy would never mint/renew its cert (review LOW-2)
    const key = `caddyask:${domain}`
    // Fail OPEN on a Redis error: the throttle is a guard rail, the DB is the authority. Caddy
    // mints a cert iff this answers 200, so ANY non-200 — including a 500 from an unhandled
    // rejection — reads as "deny" and that tenant's certificate silently stops renewing. Since
    // `enableOfflineQueue: false`, a disconnected Redis rejects promptly instead of hanging, which
    // makes this the difference between a skipped throttle and an expired customer certificate.
    let n = 0
    try {
      n = (await deps.redis.eval(RL_SCRIPT, 1, key, String(deps.askRateLimit.windowS))) as number
    } catch {
      /* throttle unavailable — let the verified-domain check below decide */
    }
    if (n > deps.askRateLimit.max) return c.text('rate limited', 429)
    // Caddy mints a cert iff 200
    return (await deps.db.tenantDomains.isVerifiedDomain(domain)) ? c.text('ok', 200) : c.text('denied', 403)
  })

  app.get('/v1/branding', async (c) => {
    // Caddy reverse_proxy sets X-Forwarded-Host to the client's original host; fall back to Host for
    // direct hits. Only when we are actually BEHIND that proxy: the header is client-controlled on a
    // direct hit, and this response now decides what every pre-auth screen looks like. Caddy's
    // reverse_proxy preserves the original Host by default, so the fallback carries white-label
    // resolution on its own even if TRUST_PROXY were ever unset — XFH is belt to that braces.
    const rawHost = (deps.trustProxy === true ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host') ?? ''
    const host = rawHost.split(':')[0]!.toLowerCase()
    // The response varies by HOST, and it is `public` — without Vary the cache key is the path
    // alone, so any cache in front of the API (or a shared one anywhere) would serve one tenant's
    // logo, colours and title under another tenant's domain. Harmless while one page called this;
    // it is now the first request of every login screen.
    c.header('Cache-Control', 'public, max-age=60')
    c.header('Vary', 'X-Forwarded-Host, Host')
    if (!isHostname(host)) return c.json({ whiteLabel: false })
    const tenantId = await deps.db.tenantDomains.tenantIdForDomain(host)
    if (tenantId === null) return c.json({ whiteLabel: false })
    const tenant = await deps.db.tenants.get(tenantId)
    // same tolerance as the manifest: one bad key must not 500 an unauthenticated route, and the
    // response must carry ONLY the five schema fields — the column accepts arbitrary keys from the
    // platform path, and this endpoint is public
    const branding = brandingReadSchema.safeParse(tenant?.branding ?? {}).data ?? {}
    // NO `?? tenant.name` fallback: the line this replaces said "never leak the tenant's
    // internal/legal name" and then did exactly that. It is unauthenticated, and the web now feeds
    // it into document.title — so a tenant who never set a product name was publishing "UAB
    // Whatever" as the visible brand and browser-tab title of their own public login page.
    //
    // `whiteLabel` is the fact the client actually needs and this endpoint used to throw away. The
    // web inferred it from "did any branding field come back", so a reseller who verified their
    // domain BEFORE filling in the branding form got the full platform wordmark on the one screen
    // all their customers pass through. The host resolving to a tenant is the answer, and it is
    // knowable here and nowhere else.
    return c.json({ whiteLabel: true, branding, ...(branding.productName !== undefined ? { productName: branding.productName } : {}) })
  })

  /**
   * The PWA manifest, branded by Host.
   *
   * `applyBranding` rewrites the title and the favicon at runtime and could never rewrite this: the
   * manifest is a static file the browser fetches itself, so "Install app" offered a white-label
   * tenant's user an app called **Orbetra**, and the home-screen icon they tapped for the next two
   * years was ours. Of every leak in the product this was the longest-lived — a flash you can fix
   * with a re-render, an icon on someone's phone you cannot.
   *
   * It lives under /v1/ so no edge configuration is needed: the tenant Caddy block already proxies
   * /v1/* to the API, and `<link rel="manifest">` may point anywhere.
   */
  app.get('/v1/public/manifest.webmanifest', async (c) => {
    const rawHost = (deps.trustProxy === true ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host') ?? ''
    const host = rawHost.split(':')[0]!.toLowerCase()
    c.header('Cache-Control', 'public, max-age=60')
    c.header('Vary', 'X-Forwarded-Host, Host')
    c.header('Content-Type', 'application/manifest+json')
    const tenantId = isHostname(host) ? await deps.db.tenantDomains.tenantIdForDomain(host) : null
    // Through the TOLERANT schema, not a cast. `branding` is a jsonb the platform tenant path
    // writes unvalidated, so `productName: 42` reached `.slice(0, 24)` and threw — a 500 on a route
    // the browser fetches on first paint of every page on that host.
    const raw = tenantId !== null ? (await deps.db.tenants.get(tenantId))?.branding ?? {} : {}
    const branding = brandingReadSchema.safeParse(raw).data ?? {}
    const isTenant = tenantId !== null
    // A tenant with no product name gets their HOST as the app name — never ours, and never their
    // internal company name (which this endpoint deliberately does not return anywhere else).
    const name = branding.productName ?? (isTenant ? host : PLATFORM_MANIFEST.name)
    // ONE entry with `sizes: 'any'`: the logo is pinned to https and nothing else, so declaring it
    // a 512×512 PNG would be a guess — an SVG or a 32px favicon advertised as a large raster is
    // skipped or upscaled by the engine. `any` is the honest declaration for an unknown asset.
    // A tenant with NO logo gets none, which does mean their app is not installable (Chrome wants
    // an icon ≥192px) — an install prompt carrying OUR mark is the worse outcome, and the setup
    // guide asks them for a logo precisely here.
    const icons = typeof branding.logoUrl === 'string' && branding.logoUrl.startsWith('https://')
      ? [{ src: branding.logoUrl, sizes: 'any' }]
      : isTenant
        ? []
        : PLATFORM_MANIFEST.icons
    const theme = typeof branding.primary === 'string' && /^#[0-9a-fA-F]{6}$/.test(branding.primary) ? branding.primary : PLATFORM_MANIFEST.theme_color
    return c.body(JSON.stringify({ ...PLATFORM_MANIFEST, name, short_name: [...name].slice(0, 24).join(''), theme_color: theme, background_color: theme, icons }))
  })

  // PUBLIC temporary share link (V1-nice): resolve an opaque token → ONE device's latest valid
  // position + the operator-chosen public label. No auth (the token IS the capability).
  // Expiry/revoke enforced in resolveByHash's query; rate-limited per CLIENT IP; never cacheable.
  app.get('/v1/public/share/:token', async (c) => {
    const token = c.req.param('token')
    c.header('Cache-Control', 'no-store')
    // cheap shape gate before any Redis/DB work — a real token is 64 hex chars
    if (!/^[0-9a-f]{64}$/.test(token)) return problem(c, 404, 'Not Found')
    // config-missing → 503 before spending rate-limit budget or a DB query (review LOW-3)
    if (deps.pool === undefined) return problem(c, 503, 'Service Unavailable', 'positions store not configured')
    // rate-limit per REAL client IP (atomic) — caps an abusive IP's flood of distinct tokens
    // without penalising legitimate viewers of a shared link (each on its own IP)
    try {
      const ip = clientIp(c.req.header('x-forwarded-for'), deps.getRemoteAddr(c), deps.trustProxy)
      const n = (await deps.redis.eval(RL_SCRIPT, 1, `share:rl:${ip}`, String(deps.shareRateLimit.windowS))) as number
      if (n > deps.shareRateLimit.max) return problem(c, 429, 'Too Many Requests')
    } catch {
      /* fail OPEN on a Redis blip — a public read is low-value; availability wins */
    }

    const hash = hashShareToken(token)
    const resolved = await deps.db.shareLinks.resolveByHash(hash)
    if (resolved === null) return problem(c, 404, 'Not Found') // unknown / expired / revoked
    // existence + tenant-consistency check scoped to the RESOLVED tenant (never a client param):
    // if the device was reassigned/erased since minting, this 404s rather than leaking anything
    const device = await deps.db.devices.get({ tenantId: resolved.tenantId }, resolved.deviceId.toString())
    if (device === null) return problem(c, 404, 'Not Found')
    const pos = await readLatestValidPosition(deps.pool, resolved.deviceId)
    // NB: device.name (internal, may carry PII) is INTENTIONALLY not exposed — only the link's label
    const view: PublicShareView = {
      label: resolved.label,
      expiresAt: resolved.expiresAt,
      position: pos === null ? null : { lat: pos.lat, lon: pos.lon, fixTime: pos.fixTime, speedKph: pos.speed, course: pos.course },
    }
    return c.json(view)
  })

  return app
}
