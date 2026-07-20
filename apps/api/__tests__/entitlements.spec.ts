import { describe, expect, it } from 'vitest'

import type { Db } from '@orbetra/db'
import type { TenantPlan } from '@orbetra/shared'

import { createApp } from '../src/app.js'
import { fakeDb, mintTestToken, TEST_JWT_SECRET } from './helpers/auth.js'

/**
 * WP2 — tenant-plan entitlement enforcement (apps/api). A Direct-plan tenant (no white-label,
 * sub-accounts, API, webhooks, custom domains; device-capped) is gated with 403
 * `plan_upgrade_required`; a TSP-plan tenant (tsp_grow, all features, uncapped) passes the plan
 * gate. Device caps return 403 `device_limit_reached`. Both the role AND the plan gate must pass.
 *
 * Uses the in-memory fakeDb (no testcontainers): the plan gate reads only db.tenants.getPlan, and
 * the cap check adds db.devices.countActive — both stubbed here. On a 403 the handler never runs,
 * so no redis is touched; passing cases are stubbed to resolve before any redis/registry work.
 */

// valid v4 UUIDs (zod's .uuid() enforces the version/variant nibbles)
const ACC = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const PROFILE = '33333333-3333-4333-8333-333333333333'

/** fakeDb with getPlan/countActive + the minimal stubs the passing handlers reach (no redis). */
function buildDb(plan: TenantPlan, activeCount = 0): Db {
  const db = fakeDb()
  db.tenants.getPlan = () => Promise.resolve(plan)
  db.tenants.updateBranding = () => Promise.resolve({ id: TENANT, name: 'T', branding: {} } as never)
  db.tenantDomains.list = () => Promise.resolve([] as never)
  db.accounts.get = () => Promise.resolve({ id: ACC, name: 'A', timezone: 'UTC' } as never)
  db.accounts.create = () => Promise.resolve({ id: ACC, name: 'A' } as never)
  db.webhooks.list = () => Promise.resolve([] as never)
  db.webhooks.create = () => Promise.resolve({ id: 'w1', url: 'https://x.test' } as never)
  db.webhookDeliveries.list = () => Promise.resolve([] as never)
  db.apiKeys.list = () => Promise.resolve([] as never)
  db.apiKeys.create = () => Promise.resolve({ key: 'orb_live_test', view: { id: 'k1', name: 'CI' } } as never)
  db.devices.countActive = () => Promise.resolve(activeCount)
  // device-create reaches profiles.get AFTER the cap gate → null ⇒ deterministic 400 (never redis)
  db.profiles.get = () => Promise.resolve(null)
  // import reads profiles.map() BEFORE the cap gate → return a Map so an over-cap batch 403s cleanly
  db.profiles.map = () => Promise.resolve(new Map<string, string>())
  return db
}

function makeApp(db: Db) {
  return createApp({
    redis: {} as never, redisSub: {} as never, db,
    jwtSecret: TEST_JWT_SECRET, jwtTtlS: 900, refreshTtlS: 3600,
    lockout: { maxFails: 5, windowS: 900 }, secureCookies: false, trustProxy: false,
  })
}

const admin = () => mintTestToken({ userId: 'u1', tenantId: TENANT, role: 'tsp_admin' })
const platform = () => mintTestToken({ userId: 'u0', tenantId: TENANT, role: 'platform_admin' })

async function call(db: Db, path: string, method: string, token: string, body?: unknown): Promise<Response> {
  const app = makeApp(db)
  return app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const deviceBody = { accountId: ACC, profileId: PROFILE, imei: '356307042440000', name: 'Van' }
const webhookBody = { accountId: null, url: 'https://hook.test/x', secret: 'abcdefghijklmnop' }

/** Assert a 403 with the plan-gate detail the web keys on. */
async function expectPlanUpgrade(res: Response): Promise<void> {
  expect(res.status).toBe(403)
  expect((await res.json() as { detail?: string }).detail).toBe('plan_upgrade_required')
}

describe('WP2 entitlements — a Direct-plan (direct_10) tenant is gated', () => {
  const plan: TenantPlan = 'direct_10'
  const gated: [string, string, unknown?][] = [
    ['/v1/tenant/branding', 'PATCH', { branding: {} }], // whiteLabel
    ['/v1/tenant/domains', 'GET'], // customDomains
    ['/v1/tenant/domains', 'POST', { domain: 'x.example.com' }],
    ['/v1/accounts', 'POST', { name: 'Second' }], // subAccounts
    ['/v1/webhooks', 'GET'], // webhooks
    ['/v1/webhooks', 'POST', webhookBody],
    ['/v1/webhook-deliveries', 'GET'],
    ['/v1/api-keys', 'GET'], // apiAccess (inline)
    ['/v1/api-keys', 'POST', { name: 'CI' }],
    ['/v1/api-keys/k1', 'DELETE'],
  ]
  for (const [path, method, body] of gated) {
    it(`${method} ${path} → 403 plan_upgrade_required`, async () => {
      await expectPlanUpgrade(await call(buildDb(plan), path, method, await admin(), body))
    })
  }

  it('GET /v1/tenant/branding stays OPEN (only PATCH is white-label gated)', async () => {
    const db = buildDb(plan)
    db.tenants.get = () => Promise.resolve({ id: TENANT, name: 'T', branding: {} } as never)
    const res = await call(db, '/v1/tenant/branding', 'GET', await admin())
    expect(res.status).toBe(200)
  })

  it('GET /v1/accounts stays OPEN (only POST is sub-accounts gated)', async () => {
    const db = buildDb(plan)
    db.accounts.list = () => Promise.resolve([{ id: ACC, name: 'A' }] as never)
    const res = await call(db, '/v1/accounts', 'GET', await admin())
    expect(res.status).toBe(200)
  })
})

describe('WP2 entitlements — device cap (deviceLimit)', () => {
  it('POST /v1/devices at the cap → 403 device_limit_reached', async () => {
    const res = await call(buildDb('direct_5', 5), '/v1/devices', 'POST', await admin(), deviceBody)
    expect(res.status).toBe(403)
    expect((await res.json() as { detail?: string }).detail).toBe('device_limit_reached')
  })

  it('POST /v1/devices under the cap passes the cap gate (400 unknown profileId, not 403)', async () => {
    const res = await call(buildDb('direct_5', 4), '/v1/devices', 'POST', await admin(), deviceBody)
    expect(res.status).toBe(400) // reached profile validation past the cap gate
  })

  it('POST /v1/devices/import over the cap → 403 device_limit_reached', async () => {
    const csv = 'imei,name,profileKey\n356307042440000,Van,fmb920\n356307042440018,Bus,fmb920\n'
    const res = await call(buildDb('direct_5', 5), '/v1/devices/import', 'POST', await admin(), { csv })
    expect(res.status).toBe(403)
    expect((await res.json() as { detail?: string }).detail).toBe('device_limit_reached')
  })

  it('a tsp_grow tenant is uncapped: device create is NOT device-limit blocked', async () => {
    const res = await call(buildDb('tsp_grow', 9999), '/v1/devices', 'POST', await admin(), deviceBody)
    expect(res.status).toBe(400) // past the (skipped) cap gate → profile validation
  })

  it('quarantine claim enforces the TARGET tenant cap → 403 device_limit_reached', async () => {
    const body = { tenantId: TENANT, accountId: ACC, profileId: PROFILE, name: 'Claimed' }
    const res = await call(buildDb('direct_5', 5), '/v1/quarantine/356307042440000/claim', 'POST', await platform(), body)
    expect(res.status).toBe(403)
    expect((await res.json() as { detail?: string }).detail).toBe('device_limit_reached')
  })
})

describe('WP2 entitlements — a TSP-plan (tsp_grow) tenant passes the plan gate', () => {
  const plan: TenantPlan = 'tsp_grow'
  it('PATCH /v1/tenant/branding → 200', async () => {
    expect((await call(buildDb(plan), '/v1/tenant/branding', 'PATCH', await admin(), { branding: {} })).status).toBe(200)
  })
  it('GET /v1/tenant/domains → 200', async () => {
    expect((await call(buildDb(plan), '/v1/tenant/domains', 'GET', await admin())).status).toBe(200)
  })
  it('POST /v1/accounts → 201', async () => {
    expect((await call(buildDb(plan), '/v1/accounts', 'POST', await admin(), { name: 'Second' })).status).toBe(201)
  })
  it('GET /v1/webhooks → 200', async () => {
    expect((await call(buildDb(plan), '/v1/webhooks', 'GET', await admin())).status).toBe(200)
  })
  it('POST /v1/webhooks → 201', async () => {
    expect((await call(buildDb(plan), '/v1/webhooks', 'POST', await admin(), webhookBody)).status).toBe(201)
  })
  it('GET /v1/api-keys → 200 and POST → 201 (apiAccess granted)', async () => {
    expect((await call(buildDb(plan), '/v1/api-keys', 'GET', await admin())).status).toBe(200)
    expect((await call(buildDb(plan), '/v1/api-keys', 'POST', await admin(), { name: 'CI' })).status).toBe(201)
  })
})
