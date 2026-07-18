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
})
