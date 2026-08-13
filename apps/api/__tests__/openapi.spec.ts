import { describe, expect, it } from 'vitest'

import { apiManifest } from '../src/app.js'
import { buildOpenApi } from '../src/openapi.js'

const spec = buildOpenApi(apiManifest(), 'https://api.orbetra.test') as {
  openapi: string
  info: { title: string }
  servers: { url: string }[]
  paths: Record<string, Record<string, { security: Record<string, string[]>[]; tags: string[] }>>
  components: { securitySchemes: Record<string, unknown> }
}

describe('E06-5 OpenAPI document', () => {
  it('is a 3.1 document with the two security schemes', () => {
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('Orbetra API')
    expect(spec.servers[0]!.url).toBe('https://api.orbetra.test')
    expect(Object.keys(spec.components.securitySchemes).sort()).toEqual(['apiKeyAuth', 'bearerAuth'])
  })

  it('covers every manifest route (generated from it → cannot drift)', () => {
    for (const m of apiManifest()) {
      const p = m.path.replace(/:([a-zA-Z]+)/g, '{$1}')
      expect(spec.paths[p], `${m.method} ${p}`).toBeDefined()
      expect(spec.paths[p]![m.method]).toBeDefined()
    }
  })

  it('includes the curated non-manifest routes (auth, reports, api-keys)', () => {
    expect(spec.paths['/v1/auth/login']?.['post']).toBeDefined()
    expect(spec.paths['/v1/reports/{type}']?.['post']).toBeDefined()
    expect(spec.paths['/v1/api-keys']?.['post']).toBeDefined()
    expect(spec.paths['/v1/api-keys/{id}']?.['delete']).toBeDefined()
  })

  it('documents the billing, web-push and public-share route groups', () => {
    expect(spec.paths['/v1/billing']?.['get']).toBeDefined()
    expect(spec.paths['/v1/billing/checkout']?.['post']).toBeDefined()
    expect(spec.paths['/v1/billing/portal']?.['post']).toBeDefined()
    expect(spec.paths['/v1/webhooks/stripe']?.['post']).toBeDefined()
    expect(spec.paths['/v1/push/vapid-key']?.['get']).toBeDefined()
    expect(spec.paths['/v1/push/subscribe']?.['post']).toBeDefined()
    expect(spec.paths['/v1/push/unsubscribe']?.['post']).toBeDefined()
    expect(spec.paths['/v1/public/share/{token}']?.['get']).toBeDefined()
  })

  it('billing is JWT-only; push writes are JWT-only; webhook + share are public', () => {
    expect(spec.paths['/v1/billing']!['get']!.security).toEqual([{ bearerAuth: [] }])
    expect(spec.paths['/v1/push/subscribe']!['post']!.security).toEqual([{ bearerAuth: [] }])
    expect(spec.paths['/v1/webhooks/stripe']!['post']!.security).toEqual([])
    expect(spec.paths['/v1/public/share/{token}']!['get']!.security).toEqual([])
    // logout is public; ws-ticket accepts a JWT or an API key
    expect(spec.paths['/v1/auth/logout']!['post']!.security).toEqual([])
    expect(spec.paths['/v1/ws-ticket']!['get']!.security.map((s) => Object.keys(s)[0]).sort()).toEqual(['apiKeyAuth', 'bearerAuth'])
  })

  it('GET accepts a JWT or an API key; writes require the JWT only', () => {
    const getDevices = spec.paths['/v1/devices']!['get']!
    expect(getDevices.security.map((s) => Object.keys(s)[0]).sort()).toEqual(['apiKeyAuth', 'bearerAuth'])
    const postRules = spec.paths['/v1/rules']!['post']!
    expect(postRules.security).toEqual([{ bearerAuth: [] }])
  })

  it('login is public (no security)', () => {
    expect(spec.paths['/v1/auth/login']!['post']!.security).toEqual([])
  })

  it('path params are converted to OpenAPI {} form', () => {
    expect(spec.paths['/v1/devices/{id}']).toBeDefined()
    expect(spec.paths['/v1/devices/:id']).toBeUndefined()
  })

  it('the metered device routes advertise 429 — a client that cannot see it will not honour Retry-After', () => {
    // the branch is keyed on the raw manifest path, so renaming either route silently drops the
    // documented 429 and the manifest meta-test would not notice
    const doc = buildOpenApi(apiManifest()) as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> }
    expect(doc.paths['/v1/devices']!['post']!.responses['429']).toBeDefined()
    expect(doc.paths['/v1/devices/import']!['post']!.responses['429']).toBeDefined()
    // …and an ordinary write does not, so the branch is not just "429 on everything"
    expect(doc.paths['/v1/rules']!['post']!.responses['429']).toBeUndefined()
    // …and neither does the READ on the same path. Keyed on the path alone, the metered-create rider
    // leaked a 409 'IMEI already registered' and a creation-ceiling 429 onto GET /v1/devices — a list
    // that can return neither. Advertising a status a handler cannot produce is the defect this whole
    // response work exists to remove, so it is guarded on both sides.
    expect(doc.paths['/v1/devices']!['get']!.responses['409']).toBeUndefined()
    expect(doc.paths['/v1/devices']!['get']!.responses['429']).toBeUndefined()
  })

  it('documents the success status each POST actually returns, item paths included', () => {
    const doc = buildOpenApi(apiManifest()) as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> }
    // item-path POSTs that CREATE answer 201 — a generated client coded for 200 treats the real
    // response as undeclared and falls into its error branch on success
    for (const p of ['/v1/devices/{id}/commands', '/v1/devices/{id}/shares', '/v1/accounts/{id}/export']) {
      expect(doc.paths[p]!['post']!.responses['201']).toBeDefined()
    }
    // …and export declares 200 TOO, because it has two success branches: a request that finds an
    // export already pending returns that job unchanged with 200 rather than starting a second one.
    // A client coded from the 201 alone falls into its error branch on every double-click.
    expect(doc.paths['/v1/accounts/{id}/export']!['post']!.responses['200']).toBeDefined()
    // the sibling item-creates have ONE success branch and must not gain a spurious 200
    expect(doc.paths['/v1/devices/{id}/commands']!['post']!.responses['200']).toBeUndefined()
    // …while a genuine action answers 200 and must NOT claim to create
    expect(doc.paths['/v1/maintenance/{id}/serviced']!['post']!.responses['200']).toBeDefined()
    expect(doc.paths['/v1/maintenance/{id}/serviced']!['post']!.responses['201']).toBeUndefined()
    // a collection POST that computes rather than creates (import preview) answers 200
    expect(doc.paths['/v1/devices/import/preview']!['post']!.responses['200']).toBeDefined()
    expect(doc.paths['/v1/devices/import/preview']!['post']!.responses['201']).toBeUndefined()
    // DELETE never creates
    expect(doc.paths['/v1/rules/{id}']!['delete']!.responses['201']).toBeUndefined()
    expect(doc.paths['/v1/rules/{id}']!['delete']!.responses['404']).toBeDefined()
  })

  it('erase documents 202 and NOT 200 — the difference is whether the device is already erased', () => {
    const doc = buildOpenApi(apiManifest()) as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> }
    const erase = doc.paths['/v1/devices/{id}/erase']!['post']!.responses
    // the handler's only success return is 202 (crud.ts, `{ queued: true }`). A client reading the
    // documented 200 concludes the erase has HAPPENED and stops polling — on a GDPR path, where
    // "we deleted it" is an assertion made to a regulator.
    expect(erase['202']).toBeDefined()
    expect(erase['200']).toBeUndefined()
    // the failure statuses the shape and its EXTRA entry contribute survive the override
    for (const s of ['400', '401', '403', '404', '409', '503']) expect(erase[s]).toBeDefined()
    // …and the override is keyed per path, so a sibling action still answers 200
    expect(doc.paths['/v1/maintenance/{id}/serviced']!['post']!.responses['202']).toBeUndefined()
  })
})
