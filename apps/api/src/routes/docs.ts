import type { Hono } from 'hono'

import type { Db } from '@orbetra/db'

import { buildOpenApi } from '../openapi.js'
import type { AuthEnv } from '../auth/middleware.js'
import type { ManifestEntry } from './registry.js'

/**
 * API docs (E06-5, §6.6). PUBLIC (registered before the /v1/* auth guard): the OpenAPI
 * document at /v1/openapi.json and an HTML reference at /v1/docs rendered by Scalar
 * (ADR-037): the standalone browser bundle from jsDelivr, PINNED to an exact version —
 * jsDelivr rewrites minified artifacts so SRI is unusable; the pin is the supply-chain
 * control, and bumps are deliberate edits here. No npm dependency enters the server. The
 * page uses an inline bootstrap script, so a future strict CSP needs a nonce/hash plus a
 * cdn.jsdelivr.net allowance — none is set today (security.ts note unchanged). The spec is
 * generated from the route manifest, so the CRUD half cannot drift from the live routes. The
 * curated half (auth, billing, push, reports, …) is hand-maintained and CAN drift — it is a
 * selection of the routes an integrator needs, not a mirror of every registered route.
 *
 * BOTH routes carry OUR name — `title: 'Orbetra API'`, "the REST API behind the Orbetra platform",
 * a link to orbetra.com/docs — and both are registered BEFORE the /v1/* auth guard. Until now the
 * only thing keeping them off a reseller's hostname was four `respond 404` lines in one Caddy site
 * block (audit W-10). That is the same shape this codebase already decided was not enough for
 * `/v1/internal/caddy-ask`, whose test says it outright: *"the Caddyfile 404s /v1/internal/* at
 * every host block; this is the second lock, so a future host block that forgets it cannot silently
 * re-open the door."* These routes get the same second lock.
 */
export function mountDocs(app: Hono<AuthEnv>, opts: { manifest: ManifestEntry[]; serverUrl?: string; db?: Db; trustProxy?: boolean }): void {
  const spec = buildOpenApi(opts.manifest, opts.serverUrl ?? '/')

  /**
   * Is this request arriving on a hostname that belongs to a TENANT?
   *
   * Answered by the same predicate the whole white-label surface uses, so there is one definition of
   * "this host is theirs". A hostname we cannot resolve to a tenant is ours (or a direct hit), and
   * the docs are served — the fail direction is deliberate: an unreachable database must not take
   * down our own API reference, and Caddy is still the outer lock.
   */
  const onTenantHost = async (c: { req: { header(n: string): string | undefined } }): Promise<boolean> => {
    if (opts.db === undefined) return false
    const raw = (opts.trustProxy === true ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host') ?? ''
    const host = raw.split(':')[0]!.toLowerCase()
    if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(host)) return false
    try {
      return (await opts.db.tenantDomains.tenantIdForDomain(host)) !== null
    } catch {
      return false
    }
  }

  app.get('/v1/openapi.json', async (c) => {
    if (await onTenantHost(c)) return c.notFound()
    c.header('Cache-Control', 'public, max-age=300')
    return c.json(spec)
  })

  app.get('/v1/docs', async (c) => {
    if (await onTenantHost(c)) return c.notFound()
    c.header('Content-Type', 'text/html; charset=utf-8')
    return c.body(DOCS_HTML)
  })
}

// Scalar reference (ADR-037) — same integration shape as extractbee.com/api/reference,
// including the kepler theme. Version pinned on purpose; bump it here, not to `latest`.
const SCALAR_SRC = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.65.1/dist/browser/standalone.min.js'

const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orbetra API</title>
<style>body{margin:0}#fallback{font:15px/1.5 system-ui,sans-serif;padding:2rem}</style>
</head>
<body>
<div id="app"><noscript><p id="fallback">JavaScript is required. The machine-readable spec is at <a href="/v1/openapi.json">/v1/openapi.json</a>.</p></noscript></div>
<script src="${SCALAR_SRC}"></script>
<script>
if (typeof Scalar !== 'undefined') {
  Scalar.createApiReference('#app', { url: '/v1/openapi.json', theme: 'kepler' })
} else {
  // CDN unreachable — leave the reader a working pointer instead of a blank page
  document.getElementById('app').innerHTML = '<p id="fallback">Could not load the docs renderer. The machine-readable spec is at <a href="/v1/openapi.json">/v1/openapi.json</a>.</p>'
}
</script>
</body>
</html>`
