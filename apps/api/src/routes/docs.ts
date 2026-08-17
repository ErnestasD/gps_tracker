import type { Hono } from 'hono'

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
 */
export function mountDocs(app: Hono<AuthEnv>, opts: { manifest: ManifestEntry[]; serverUrl?: string }): void {
  const spec = buildOpenApi(opts.manifest, opts.serverUrl ?? '/')

  app.get('/v1/openapi.json', (c) => {
    c.header('Cache-Control', 'public, max-age=300')
    return c.json(spec)
  })

  app.get('/v1/docs', (c) => {
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
