import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '@orbetra/api'

import { setup, type Fixtures, type TenantFixture } from './fixtures.js'

/**
 * Cross-tenant isolation suite (E03-2, PROJECT_PLAN §6.2 / §10 #7). Manifest-driven:
 * iterates the api's exported route manifest and hits every scoped endpoint across
 * the tenant/account boundary, expecting 404/403. NEW endpoints are auto-covered —
 * the meta-test forces them into the manifest, so they land here automatically.
 * CI-blocking forever (this package's `test` script runs under `turbo run test`).
 */

let fx: Fixtures

beforeAll(async () => {
  fx = await setup()
}, 300_000)
afterAll(async () => {
  await fx?.stop()
})

const req = (path: string, token: string, method = 'GET') =>
  fetch(`${fx.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    // PATCH/POST carry an empty-but-valid body so validation passes and the scope
    // check (not a 400) decides the outcome
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
  })

/** Seeded resource id of a given entity within a tenant fixture. */
function idFor(f: TenantFixture, entity: string): string {
  const map: Record<string, string> = {
    account: f.accounts[0],
    user: f.userId,
    rule: f.ruleId,
    webhook: f.webhookId,
    event: f.eventId,
    tenant: f.id,
  }
  return map[entity] ?? ''
}
const itemPath = (path: string, resourceId: string) => path.replace(':id', resourceId)

describe('E03-2 tenant isolation (manifest-driven)', () => {
  it('every scoped item route: T1 admin against a T2 resource → 404 (never a leak)', async () => {
    const items = fx.manifest.filter((m) => m.shape === 'item' && m.scopeClass !== 'platform')
    expect(items.length).toBeGreaterThan(0)
    for (const m of items) {
      const path = itemPath(m.path, idFor(fx.t2, m.entity))
      const res = await req(path, fx.t1.tokenTenant, m.method.toUpperCase())
      expect(res.status, `${m.method} ${path} as T1`).toBe(404)
    }
  })

  it('every scoped collection GET: T1 list never contains a T2 resource id', async () => {
    const collections = fx.manifest.filter((m) => m.shape === 'collection' && m.method === 'get' && m.scopeClass !== 'platform')
    for (const m of collections) {
      const res = await req(m.path, fx.t1.tokenTenant)
      expect(res.status).toBe(200)
      const body = (await res.json()) as unknown[] | { id?: string }[]
      const ids = new Set((Array.isArray(body) ? body : []).map((r) => String((r as { id?: string }).id)))
      expect(ids.has(idFor(fx.t2, m.entity)), `${m.path} leaked T2 ${m.entity}`).toBe(false)
    }
  })

  it('platform routes: a tenant admin (non-platform_admin) → 403', async () => {
    const platform = fx.manifest.filter((m) => m.scopeClass === 'platform')
    expect(platform.length).toBeGreaterThan(0)
    for (const m of platform) {
      const path = itemPath(m.path, idFor(fx.t2, m.entity))
      const res = await req(path, fx.t1.tokenTenant, m.method.toUpperCase())
      expect(res.status, `${m.method} ${path} as tsp_admin`).toBe(403)
    }
  })

  it('account scope: A1 manager cannot reach a sibling account (A2) — 404 on item, excluded from list', async () => {
    // A2 account item → 404 for an A1-scoped manager
    const a2 = await req(`/v1/accounts/${fx.t1.accounts[1]}`, fx.t1.tokenAccountA1)
    expect(a2.status).toBe(404)
    // account list returns only A1
    const list = (await (await req('/v1/accounts', fx.t1.tokenAccountA1)).json()) as { id: string }[]
    expect(list.map((a) => a.id)).toEqual([fx.t1.accounts[0]])
  })

  it('positive control: T1 admin CAN reach its own resources (proves 404s are scope, not breakage)', async () => {
    for (const m of fx.manifest.filter((x) => x.shape === 'item' && x.scopeClass !== 'platform')) {
      const res = await req(itemPath(m.path, idFor(fx.t1, m.entity)), fx.t1.tokenTenant)
      expect(res.status, `own ${m.path}`).toBe(200)
    }
  })

  it('platform_admin CAN administer any tenant (platform scope is not a leak)', async () => {
    const res = await req(`/v1/tenants/${fx.t2.id}`, fx.t1.tokenPlatform)
    expect(res.status).toBe(200)
  })
})

describe('E03-2 meta-test: manifest completeness (AC[3])', () => {
  it('every registered /v1 data route has a manifest entry — an unlisted route fails the suite', () => {
    const app = createApp({
      redis: {} as never, redisSub: {} as never, db: {} as never,
      jwtSecret: 'x'.repeat(32), jwtTtlS: 900, refreshTtlS: 3600,
      lockout: { maxFails: 5, windowS: 900 }, secureCookies: false, trustProxy: false,
    })
    // Hono exposes registered routes; the auth/public + infra routes are exempt
    const EXEMPT = /^\/(healthz|metrics)$|^\/v1\/(auth|ws-ticket|devices\/last|stream)|^\/v1\/\*$/
    const registered = (app.routes as { method: string; path: string }[])
      .filter((r) => r.path.startsWith('/v1/') && !EXEMPT.test(r.path))
      .map((r) => `${r.method} ${r.path}`)
    const manifested = new Set(fx.manifest.map((m) => `${m.method.toUpperCase()} ${m.path}`))
    const missing = registered.filter((r) => !manifested.has(r))
    expect(missing, 'these live routes are not in the manifest — register them').toEqual([])
  })

  it('detects a route added OUTSIDE the manifest (probe)', () => {
    const app = createApp({
      redis: {} as never, redisSub: {} as never, db: {} as never,
      jwtSecret: 'x'.repeat(32), jwtTtlS: 900, refreshTtlS: 3600,
      lockout: { maxFails: 5, windowS: 900 }, secureCookies: false, trustProxy: false,
    })
    app.get('/v1/sneaky', (c) => c.json({}))
    const EXEMPT = /^\/(healthz|metrics)$|^\/v1\/(auth|ws-ticket|devices\/last|stream)|^\/v1\/\*$/
    const registered = (app.routes as { method: string; path: string }[])
      .filter((r) => r.path.startsWith('/v1/') && !EXEMPT.test(r.path))
      .map((r) => `${r.method} ${r.path}`)
    const manifested = new Set(fx.manifest.map((m) => `${m.method.toUpperCase()} ${m.path}`))
    expect(registered.filter((r) => !manifested.has(r))).toContain('GET /v1/sneaky')
  })
})
