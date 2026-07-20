import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { planEntitlements, type EntitlementKey } from '@orbetra/shared'

import { setup, type Fixtures } from './fixtures.js'

/**
 * Tenant-plan entitlement gating (WP5) — proven against the REAL API + DB (testcontainer
 * stack in fixtures.ts), not a unit mock. Two tenants sit side by side:
 *   - `t1`           — tsp_grow: FULL entitlements + uncapped devices (the positive control).
 *   - `directTenant` — direct_10: NO white-label / custom-domains / sub-accounts / API / webhooks,
 *                      seeded AT its 10-device cap.
 *
 * Every gated route is exercised from BOTH sides: a Direct-plan admin must be refused (403 with the
 * stable `plan_upgrade_required` / `device_limit_reached` detail the web keys its upgrade CTA on),
 * while the SAME route + SAME role on the TSP tenant succeeds — so the 403s are the plan gate, not
 * a role or scope break.
 */

let fx: Fixtures

beforeAll(async () => {
  fx = await setup()
}, 300_000)
afterAll(async () => {
  await fx?.stop()
})

const call = (path: string, token: string, method = 'GET', bodyObj?: unknown) =>
  fetch(`${fx.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(bodyObj !== undefined ? { body: JSON.stringify(bodyObj) } : method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
  })

/** assert a 403 whose problem+json `detail` matches the plan-gate code. */
async function expect403(res: Response, detail: string, label: string): Promise<void> {
  expect(res.status, `${label} status`).toBe(403)
  const body = (await res.json()) as { detail?: string }
  expect(body.detail, `${label} detail`).toBe(detail)
}

describe('WP5 tenant-plan entitlement gating (real API+DB)', () => {
  it('sanity: fixtures carry the intended plans (direct_10 lacks TSP entitlements; tsp_grow has them)', () => {
    expect(fx.directTenant.plan).toBe('direct_10')
    expect(fx.t1.plan).toBe('tsp_grow')
    const direct = planEntitlements('direct_10')
    expect(direct.whiteLabel).toBe(false)
    expect(direct.webhooks).toBe(false)
    expect(direct.subAccounts).toBe(false)
    expect(direct.apiAccess).toBe(false)
    expect(direct.deviceLimit).toBe(10)
    expect(planEntitlements('tsp_grow').deviceLimit).toBeNull()
  })

  describe('a Direct-plan (direct_10) tenant admin is REFUSED on every TSP-only surface', () => {
    it('PATCH /v1/tenant/branding → 403 plan_upgrade_required (whiteLabel)', async () => {
      await expect403(await call('/v1/tenant/branding', fx.directTenant.tokenTenant, 'PATCH', { productName: 'Nope' }), 'plan_upgrade_required', 'branding')
    })

    it('GET + POST /v1/webhooks → 403 plan_upgrade_required (webhooks)', async () => {
      await expect403(await call('/v1/webhooks', fx.directTenant.tokenTenant, 'GET'), 'plan_upgrade_required', 'webhooks GET')
      await expect403(
        await call('/v1/webhooks', fx.directTenant.tokenTenant, 'POST', { accountId: null, url: 'https://x.test/w', secret: 'secret-secret-16' }),
        'plan_upgrade_required',
        'webhooks POST',
      )
    })

    it('GET /v1/api-keys → 403 plan_upgrade_required (apiAccess — the REST surface gate)', async () => {
      await expect403(await call('/v1/api-keys', fx.directTenant.tokenTenant, 'GET'), 'plan_upgrade_required', 'api-keys LIST')
    })

    it('POST /v1/accounts (a 2nd account) → 403 plan_upgrade_required (subAccounts)', async () => {
      await expect403(await call('/v1/accounts', fx.directTenant.tokenTenant, 'POST', { name: 'Second Account' }), 'plan_upgrade_required', 'accounts POST')
    })

    it('POST /v1/devices — creating device #11 → 403 device_limit_reached (seeded AT the direct_10 cap)', async () => {
      const res = await call('/v1/devices', fx.directTenant.tokenTenant, 'POST', {
        accountId: fx.directTenant.accounts[0],
        profileId: fx.profileId,
        imei: '356307042449999',
        name: 'over-cap',
      })
      await expect403(res, 'device_limit_reached', 'device #11')
    })
  })

  describe('the SAME routes SUCCEED for a full-entitlement (tsp_grow) tenant admin — proves the 403 is the plan gate', () => {
    it('PATCH /v1/tenant/branding → 200', async () => {
      const res = await call('/v1/tenant/branding', fx.t1.tokenTenant, 'PATCH', { productName: 'Branded' })
      expect(res.status).toBe(200)
    })

    it('POST /v1/webhooks → 201, GET /v1/webhooks → 200', async () => {
      const created = await call('/v1/webhooks', fx.t1.tokenTenant, 'POST', { accountId: null, url: 'https://x.test/ok', secret: 'secret-secret-16' })
      expect(created.status).toBe(201)
      expect((await call('/v1/webhooks', fx.t1.tokenTenant, 'GET')).status).toBe(200)
    })

    it('POST /v1/api-keys → 201, GET /v1/api-keys → 200', async () => {
      const minted = await call('/v1/api-keys', fx.t1.tokenTenant, 'POST', { name: 'iso-key' })
      expect(minted.status).toBe(201)
      expect((await call('/v1/api-keys', fx.t1.tokenTenant, 'GET')).status).toBe(200)
    })

    it('POST /v1/accounts (a 2nd account) → 201', async () => {
      const res = await call('/v1/accounts', fx.t1.tokenTenant, 'POST', { name: `Extra ${Date.now()}` })
      expect(res.status).toBe(201)
    })

    it('POST /v1/devices → 201 (tsp_grow is uncapped)', async () => {
      const res = await call('/v1/devices', fx.t1.tokenTenant, 'POST', {
        accountId: fx.t1.accounts[0],
        profileId: fx.profileId,
        imei: '356307042448888',
        name: 'uncapped',
      })
      expect(res.status).toBe(201)
    })
  })
})

describe('WP5 meta-test: every entitlement-tagged manifest route is plan-gated (mirrors the role/isolation meta-tests)', () => {
  it('a plan LACKING an entitlement 403s (plan_upgrade_required) on EVERY manifest route tagged with it', async () => {
    const tagged = fx.manifest.filter((m) => m.entitlement !== undefined)
    expect(tagged.length, 'at least one route must carry an entitlement tag').toBeGreaterThan(0)
    const directEnts = planEntitlements(fx.directTenant.plan)
    // itemPath: swap the first :param so param-carrying routes resolve; the plan gate runs BEFORE
    // the handler, so the placeholder id is never dereferenced — a 403 is returned regardless.
    const itemPath = (path: string) => path.replace(/:[a-zA-Z]+/, '00000000-0000-0000-0000-000000000000')
    for (const m of tagged) {
      // every currently-tagged entitlement is one the direct_10 plan lacks — assert that precondition
      // so this meta-test can't silently pass on a route the fixture plan happens to HAVE.
      expect(directEnts[m.entitlement as EntitlementKey], `direct_10 must lack ${m.entitlement} for ${m.method} ${m.path}`).toBe(false)
      const res = await call(itemPath(m.path), fx.directTenant.tokenTenant, m.method.toUpperCase())
      await expect403(res, 'plan_upgrade_required', `${m.method.toUpperCase()} ${m.path}`)
    }
  })
})
