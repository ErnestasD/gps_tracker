import { Hono } from 'hono'
import type { Redis } from 'ioredis'

import type { Db } from '@orbetra/db'

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

  return app
}
