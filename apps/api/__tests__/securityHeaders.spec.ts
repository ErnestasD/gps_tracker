import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { fakeDb } from './helpers/auth.js'

/**
 * E07-5 security headers — every response (health, public docs, and unauthenticated
 * problem+json) carries the header set; HSTS only in TLS deployments.
 */
function makeApp(opts: { secureCookies?: boolean; hsts?: boolean } = {}) {
  return createApp({
    redis: {} as never,
    redisSub: {} as never,
    db: fakeDb(),
    jwtSecret: 'x'.repeat(32),
    jwtTtlS: 900,
    refreshTtlS: 3600,
    lockout: { maxFails: 5, windowS: 900 },
    secureCookies: opts.secureCookies ?? false,
    trustProxy: false,
    ...(opts.hsts !== undefined ? { hsts: opts.hsts } : {}),
  })
}

const EXPECTED: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

describe('E07-5 security headers', () => {
  it('are present on /healthz', async () => {
    const res = await makeApp().request('/healthz')
    expect(res.status).toBe(200)
    for (const [h, v] of Object.entries(EXPECTED)) expect(res.headers.get(h), h).toBe(v)
  })

  it('are present on an UNAUTHENTICATED 401 (middleware runs before auth)', async () => {
    const res = await makeApp().request('/v1/devices')
    expect(res.status).toBe(401)
    for (const [h, v] of Object.entries(EXPECTED)) expect(res.headers.get(h), h).toBe(v)
  })

  it('are present on the public docs page and a 404', async () => {
    const docs = await makeApp().request('/v1/docs')
    expect(docs.status).toBe(200)
    expect(docs.headers.get('x-frame-options')).toBe('DENY')
    const missing = await makeApp().request('/nope')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('are present on a 500 from a THROWING handler (pins Hono compose semantics across bumps)', async () => {
    // the after-next() header writes only survive handler exceptions because Hono's compose
    // catches per dispatch level (verified on 4.12.27) — this test turns red if a future
    // hono bump changes error propagation and silently strips headers from 500s (review MED)
    const app = makeApp()
    app.get('/boom', () => {
      throw new Error('kaboom')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    for (const [h, v] of Object.entries(EXPECTED)) expect(res.headers.get(h), h).toBe(v)
  })

  it('HSTS is off for plain-http dev, on for TLS deployments (secureCookies or hsts)', async () => {
    const dev = await makeApp().request('/healthz')
    expect(dev.headers.get('strict-transport-security')).toBeNull()
    const tls = await makeApp({ secureCookies: true }).request('/healthz')
    expect(tls.headers.get('strict-transport-security')).toBe('max-age=15552000; includeSubDomains')
    const forced = await makeApp({ hsts: true }).request('/healthz')
    expect(forced.headers.get('strict-transport-security')).toBe('max-age=15552000; includeSubDomains')
  })
})
