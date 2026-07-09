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
