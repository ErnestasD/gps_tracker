import { Hono } from 'hono'
import type { Redis } from 'ioredis'

import { hashShareToken, readLatestValidPosition, type Db, type Pool } from '@orbetra/db'
import type { PublicShareView } from '@orbetra/shared'

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
export interface PublicDeps {
  db: Db
  redis: Redis
  askRateLimit: { max: number; windowS: number }
  /** raw-SQL pool for the public share endpoint's latest-position read; absent ⇒ share 503s. */
  pool?: Pool
  /** public share-resolve rate limit (per token, fixed window); default 60/min. */
  shareRateLimit: { max: number; windowS: number }
}

const isHostname = (s: string): boolean =>
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(s)

export function createPublicRoutes(deps: PublicDeps): Hono {
  const app = new Hono()

  app.get('/v1/internal/caddy-ask', async (c) => {
    const domain = (c.req.query('domain') ?? '').toLowerCase()
    if (!isHostname(domain)) return c.text('bad domain', 400)
    // rate-limit per DOMAIN (fixed window) — bounds cert-issuance retries for any one
    // domain without a shared bucket (all asks share Caddy's source IP)
    const key = `caddyask:${domain}`
    const n = await deps.redis.incr(key)
    if (n === 1) await deps.redis.expire(key, deps.askRateLimit.windowS)
    if (n > deps.askRateLimit.max) return c.text('rate limited', 429)
    // Caddy mints a cert iff 200
    return (await deps.db.tenantDomains.isVerifiedDomain(domain)) ? c.text('ok', 200) : c.text('denied', 403)
  })

  app.get('/v1/branding', async (c) => {
    // Caddy reverse_proxy sets X-Forwarded-Host to the client's original host; fall
    // back to Host for direct hits
    const rawHost = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? ''
    const host = rawHost.split(':')[0]!.toLowerCase()
    c.header('Cache-Control', 'public, max-age=60')
    if (!isHostname(host)) return c.json({})
    const tenantId = await deps.db.tenantDomains.tenantIdForDomain(host)
    if (tenantId === null) return c.json({})
    const tenant = await deps.db.tenants.get(tenantId)
    const branding = (tenant?.branding ?? {}) as { productName?: string }
    // prefer the public product name; never leak the tenant's internal/legal name
    return c.json({ branding, productName: branding.productName ?? tenant?.name })
  })

  // PUBLIC temporary share link (V1-nice): resolve an opaque token → ONE device's latest valid
  // position + label. No auth (the token IS the capability). Expiry/revoke enforced in
  // resolveByHash's query; rate-limited per token; never cacheable.
  app.get('/v1/public/share/:token', async (c) => {
    const token = c.req.param('token')
    c.header('Cache-Control', 'no-store')
    // cheap shape gate before any Redis/DB work — a real token is 64 hex chars
    if (!/^[0-9a-f]{64}$/.test(token)) return c.json({ error: 'not found' }, 404)
    // rate-limit per token hash (fixed window) — bounds scraping of any single link
    const hash = hashShareToken(token)
    const key = `share:${hash}`
    const n = await deps.redis.incr(key)
    if (n === 1) await deps.redis.expire(key, deps.shareRateLimit.windowS)
    if (n > deps.shareRateLimit.max) return c.json({ error: 'rate limited' }, 429)

    const resolved = await deps.db.shareLinks.resolveByHash(hash)
    if (resolved === null) return c.json({ error: 'not found' }, 404) // unknown / expired / revoked
    if (deps.pool === undefined) return c.json({ error: 'unavailable' }, 503)
    // read the device label scoped to the RESOLVED tenant (never a client param) + latest fix
    const device = await deps.db.devices.get({ tenantId: resolved.tenantId }, resolved.deviceId.toString())
    if (device === null) return c.json({ error: 'not found' }, 404) // device retired/erased since
    const pos = await readLatestValidPosition(deps.pool, resolved.deviceId)
    const view: PublicShareView = {
      deviceLabel: device.name,
      expiresAt: resolved.expiresAt,
      position: pos === null ? null : { lat: pos.lat, lon: pos.lon, fixTime: pos.fixTime, speedKph: pos.speed, course: pos.course },
    }
    return c.json(view)
  })

  return app
}
