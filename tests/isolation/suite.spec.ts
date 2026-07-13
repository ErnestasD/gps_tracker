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
    device: f.deviceId,
    domain: f.domainId,
    audit: f.auditId,
    trip: f.tripId,
    geofence: f.geofenceId,
    rule: f.ruleId,
    webhook: f.webhookId,
    event: f.eventId,
    command: f.commandId,
    export: f.exportId,
    gdpr: f.deviceId, // /v1/devices/:id/erase — the :id is a device
    tenant: f.id,
    quarantine: '356307042440000', // a real 15-digit IMEI for the claim path param
  }
  return map[entity] ?? ''
}
// replace the FIRST :param (`:id`, `:imei`, …) so param-carrying routes get a realistic
// path. All current routes are single-param; a future two-param route would need a
// global replace (or per-param ids) — revisit then.
const itemPath = (path: string, resourceId: string) => path.replace(/:[a-zA-Z]+/, resourceId)

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
    // GET item routes only — action routes (POST /verify, DELETE) aren't GET-testable
    for (const m of fx.manifest.filter((x) => x.shape === 'item' && x.method === 'get' && x.scopeClass !== 'platform')) {
      const res = await req(itemPath(m.path, idFor(fx.t1, m.entity)), fx.t1.tokenTenant)
      expect(res.status, `own ${m.path}`).toBe(200)
    }
  })

  it('platform_admin CAN administer any tenant (platform scope is not a leak)', async () => {
    const res = await req(`/v1/tenants/${fx.t2.id}`, fx.t1.tokenPlatform)
    expect(res.status).toBe(200)
  })

  it('account scope on NON-account entities: A1 manager cannot reach an A2-owned rule → 404', async () => {
    const res = await req(`/v1/rules/${fx.t1.ruleA2Id}`, fx.t1.tokenAccountA1)
    expect(res.status).toBe(404)
    const list = (await (await req('/v1/rules', fx.t1.tokenAccountA1)).json()) as { id: string }[]
    expect(list.map((r) => r.id)).not.toContain(fx.t1.ruleA2Id)
  })

  it('geofences: A1 manager cannot reach an A2 geofence (404, excluded); a tenant-shared one IS visible (E05-1)', async () => {
    // the nullable-account scope branch — a regression dropping the accountId predicate fails here
    expect((await req(`/v1/geofences/${fx.t1.geofenceA2Id}`, fx.t1.tokenAccountA1)).status).toBe(404)
    const list = (await (await req('/v1/geofences', fx.t1.tokenAccountA1)).json()) as { id: string }[]
    const ids = list.map((g) => g.id)
    expect(ids).not.toContain(fx.t1.geofenceA2Id) // sibling account's — hidden
    expect(ids).toContain(fx.t1.geofenceId) // own account's — visible
    expect(ids).toContain(fx.t1.geofenceSharedId) // tenant-shared (accountId null) — visible
  })
})

describe('E03-2 write authorization / RBAC (review HIGH)', () => {
  const post = (path: string, token: string, bodyObj: unknown) =>
    fetch(`${fx.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(bodyObj),
    })

  it('a viewer cannot write (403 on rule/webhook/account/user create)', async () => {
    expect((await post('/v1/rules', fx.t1.tokenViewerA1, { accountId: fx.t1.accounts[0], kind: 'overspeed', name: 'x' })).status).toBe(403)
    expect((await post('/v1/webhooks', fx.t1.tokenViewerA1, { accountId: null, url: 'https://x.test/w', secret: 'secret-secret-16' })).status).toBe(403)
    expect((await post('/v1/accounts', fx.t1.tokenViewerA1, { name: 'x' })).status).toBe(403)
    expect((await post('/v1/users', fx.t1.tokenViewerA1, { email: 'x@x.test', password: 'password12', role: 'viewer', accountId: fx.t1.accounts[0] })).status).toBe(403)
  })

  it('an account_manager cannot create users at all (write policy = tenant admins)', async () => {
    const res = await post('/v1/users', fx.t1.tokenAccountA1, { email: 'nope@x.test', password: 'password12', role: 'viewer', accountId: fx.t1.accounts[0] })
    expect(res.status).toBe(403)
  })

  it('a tsp_admin cannot mint a platform_admin (role-grant ceiling)', async () => {
    const res = await post('/v1/users', fx.t1.tokenTenant, { email: 'evil@x.test', password: 'password12', role: 'platform_admin', accountId: null })
    expect(res.status).toBe(403)
  })

  it('a tsp_admin CAN create a lower-tier user (positive control)', async () => {
    const res = await post('/v1/users', fx.t1.tokenTenant, { email: `ok-${Date.now()}@x.test`, password: 'password12', role: 'account_manager', accountId: fx.t1.accounts[0] })
    expect(res.status).toBe(201)
  })

  it('webhooks are tenant-level: an account_manager cannot touch even its own-account webhook (403)', async () => {
    const res = await fetch(`${fx.baseUrl}/v1/webhooks/${fx.t1.webhookId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${fx.t1.tokenAccountA1}` },
    })
    expect(res.status).toBe(403)
  })

  it('audit log is tenant-admin only: viewer + account_manager → 403, tsp_admin → 200 (E03-6)', async () => {
    expect((await req('/v1/audit', fx.t1.tokenViewerA1)).status).toBe(403)
    expect((await req('/v1/audit', fx.t1.tokenAccountA1)).status).toBe(403)
    const ok = await req('/v1/audit', fx.t1.tokenTenant)
    expect(ok.status).toBe(200)
    const rows = (await ok.json()) as { entity: string; tenantId: string }[]
    expect(Array.isArray(rows)).toBe(true)
    // every returned row belongs to T1 (never a T2 leak) — audit is tenant-scoped
    expect(rows.every((r) => r.tenantId === fx.t1.id)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('audit filters: entity=account narrows results (E03-6)', async () => {
    const accts = (await (await req('/v1/audit?entity=account', fx.t1.tokenTenant)).json()) as { entity: string }[]
    expect(accts.length).toBeGreaterThan(0)
    expect(accts.every((r) => r.entity === 'account')).toBe(true)
  })

  it('audit query params are robust: garbage cursor/limit/from never 500 (E03-6 review MED)', async () => {
    for (const qs of ['cursor=not-a-number', 'cursor=', 'limit=abc', 'limit=-5', 'from=garbage', 'to=nonsense', 'cursor=1.5&limit=NaN']) {
      const res = await req(`/v1/audit?${qs}`, fx.t1.tokenTenant)
      expect(res.status, `/v1/audit?${qs}`).toBe(200)
      expect(Array.isArray(await res.json())).toBe(true)
    }
    // a non-numeric :id is a clean 404, not a 500
    expect((await req('/v1/audit/not-an-id', fx.t1.tokenTenant)).status).toBe(404)
  })

  it('usage metering is tenant-scoped: /v1/usage sums EXACTLY the caller tenant seed (E07-4)', async () => {
    // both tenants seed 2 device-days; a tenant-scope leak would double the sum to 4
    for (const t of [fx.t1, fx.t2]) {
      const rows = (await (await req('/v1/usage', t.tokenTenant)).json()) as { day: string; deviceDays: number }[]
      const total = rows.reduce((s, r) => s + r.deviceDays, 0)
      expect(total, `tenant ${t.id} usage total`).toBe(2)
    }
  })

  it('usage RBAC: account-scoped roles cannot read the tenant bill (403), platform usage is platform-only', async () => {
    expect((await req('/v1/usage', fx.t1.tokenAccountA1)).status).toBe(403)
    expect((await req('/v1/usage', fx.t1.tokenViewerA1)).status).toBe(403)
    expect((await req('/v1/platform/usage', fx.t1.tokenTenant)).status).toBe(403) // tsp_admin ≠ platform
    // platform_admin sees BOTH tenants' summaries (unscoped by design behind the platform gate)
    const rows = (await (await req('/v1/platform/usage', fx.t1.tokenPlatform)).json()) as { tenantId: string; deviceDays: number }[]
    const byTenant = new Map(rows.map((r) => [r.tenantId, r.deviceDays]))
    expect(byTenant.get(fx.t1.id)).toBe(2)
    expect(byTenant.get(fx.t2.id)).toBe(2)
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
    const EXEMPT = /^\/(healthz|metrics)$|^\/v1\/(auth|ws-ticket|devices\/last|profiles|branding|internal\/caddy-ask|public\/pilot-request|stream|reports|api-keys|openapi\.json|docs)(?:\/|$)|^\/v1\/\*$/
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
    const EXEMPT = /^\/(healthz|metrics)$|^\/v1\/(auth|ws-ticket|devices\/last|profiles|branding|internal\/caddy-ask|public\/pilot-request|stream|reports|api-keys|openapi\.json|docs)(?:\/|$)|^\/v1\/\*$/
    const registered = (app.routes as { method: string; path: string }[])
      .filter((r) => r.path.startsWith('/v1/') && !EXEMPT.test(r.path))
      .map((r) => `${r.method} ${r.path}`)
    const manifested = new Set(fx.manifest.map((m) => `${m.method.toUpperCase()} ${m.path}`))
    expect(registered.filter((r) => !manifested.has(r))).toContain('GET /v1/sneaky')
  })
})
