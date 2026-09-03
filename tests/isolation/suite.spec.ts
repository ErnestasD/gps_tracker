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

/**
 * Routes the manifest harness does not defend, and why.
 *
 * This used to be a single regex of PREFIXES, and a prefix is the wrong unit here: `billing`
 * exempted `/v1/billing/portal` (intended) and every future `/v1/billing/*` route (not intended),
 * and a bare `webhooks` alternative — written for `POST /v1/webhooks/ses` — silently exempted the
 * whole manifested webhook CRUD plus any `/v1/webhooks/:id/test` someone adds next year. A route
 * that is invisible to the meta-test is invisible to the isolation suite, so the exemption unit
 * must be the exact route, not its neighbourhood.
 *
 * Two prefixes survive, and only because no route under them can ever have a tenant boundary to
 * defend: `/v1/auth/*` and `/v1/public/*` run BEFORE the auth middleware (`app.ts`), so there is no
 * principal to scope against, and they carry their own dedicated specs.
 */
const EXEMPT_PREFIXES = /^\/(healthz|metrics)$|^\/v1\/(auth|public|openapi\.json|docs)(?:\/|$)/

/** METHOD PATH → why this specific route is not manifest-covered. Every entry must still exist. */
const EXEMPT_ROUTES: Record<string, string> = {
  // no tenant data at all
  'GET /v1/profiles': 'global reference data — DeviceProfile has no tenantId',
  'POST /v1/routing/optimize': 'ADR-029 stateless OSRM proxy — stops come from the body, touches no repo',
  'GET /v1/internal/caddy-ask': 'Host-driven cert gate, unauthenticated by design — caddyAsk.spec.ts',
  'GET /v1/ws-ticket': 'mints a ticket for the caller’s OWN scope — ws.spec.ts redeems it cross-tenant',
  'GET /v1/branding': 'Host-driven, pre-auth — branding.spec.ts',
  'POST /v1/webhooks/ses': 'SNS ingress, signature-authenticated — sesWebhook.spec.ts',
  'POST /v1/webhooks/stripe': 'Stripe ingress, signature-authenticated — billing.spec.ts',
  // tenant data, covered by a dedicated spec because the harness shape does not fit
  'GET /v1/api-keys': 'create returns the plaintext once — apiKeys.spec.ts',
  'POST /v1/api-keys': 'create returns the plaintext once — apiKeys.spec.ts',
  'DELETE /v1/api-keys/:id': 'apiKeys.spec.ts:109 attempts a cross-tenant revoke',
  'GET /v1/devices/last': 'Redis snapshot, no :id — devicesLast.spec.ts',
  'GET /v1/driver-scores': 'aggregate, no :id — covered by the cross-tenant test below',
  'POST /v1/reports/:type': ':type is not a resource id — reports.spec.ts',
  'GET /v1/billing': 'tenant-wide Stripe state — billing.spec.ts',
  'GET /v1/billing/plans': 'the plan catalogue is platform-global',
  'POST /v1/billing/checkout': 'tenant-wide Stripe state — billing.spec.ts',
  'POST /v1/billing/portal': 'tenant-wide Stripe state — billing.spec.ts',
  'GET /v1/push/vapid-key': 'the public VAPID key is the same for every tenant',
  'POST /v1/push/subscribe': 'scope comes from the JWT only — push.spec.ts',
  'POST /v1/push/unsubscribe': 'scope comes from the JWT only — push.spec.ts',
  // the partner surface is a SECOND tenancy boundary (affiliate ↔ affiliate), not tenant ↔ tenant.
  // The manifest cannot express it; partner.spec.ts makes the cross-partner attempts instead.
  'POST /v1/partner/login': 'partner boundary — partner.spec.ts',
  'POST /v1/partner/set-password': 'partner boundary — partner.spec.ts',
  'GET /v1/partner/me': 'partner boundary — partner.spec.ts',
  'GET /v1/partner/customers': 'partner boundary — partner.spec.ts:114',
  'GET /v1/partner/commissions': 'partner boundary — partner.spec.ts:146',
  'GET /v1/partner/funnel': 'partner boundary — partner.spec.ts',
  'GET /v1/partner/deals': 'partner boundary — partner.spec.ts:444',
  'POST /v1/partner/deals': 'partner boundary — partner.spec.ts:444',
  'GET /v1/partner/statement.csv': 'partner boundary — partner.spec.ts:579',
  'POST /v1/partner/payout-request': 'partner boundary — partner.spec.ts',
}
// `/v1/stream` is deliberately absent: it is attached to the Node server, not to Hono, so it can
// never appear in `app.routes` and an entry here would read as coverage while asserting nothing.
// ws.spec.ts:115 (cross-tenant) and :305 (ticket reuse) are its real tests.

/**
 * Routes whose data has NO accountId column to be scoped by, so an account pin cannot bite and the
 * handler must refuse a pinned principal outright (`tenantWide` in crud.ts, `isTenantWideAdmin` in
 * billing.ts). Add a route here the moment you add one of that shape — this sweep is the only thing
 * that notices, because from the outside a role gate looks identical whether or not it also checks
 * the pin.
 */
const TENANT_WIDE_ONLY: readonly (readonly [string, string, string?])[] = [
  ['GET', '/v1/audit'],
  ['GET', '/v1/audit/:id', 'audit'],
  ['GET', '/v1/usage'],
  ['GET', '/v1/billing'],
  ['GET', '/v1/billing/plans'],
  ['POST', '/v1/billing/checkout'],
  ['POST', '/v1/billing/portal'],
  ['PATCH', '/v1/tenant/branding'],
  ['GET', '/v1/tenant/domains'],
  ['POST', '/v1/tenant/domains'],
  // the ITEM routes matter as much as the collection ones and were the first thing left out: the
  // DELETE below is the one that takes a verified white-label host offline for every sibling
  // account. Their id is t1's OWN, so a 403 here also proves the gate runs BEFORE the lookup —
  // a 404 would mean the route merely failed to find the row.
  ['GET', '/v1/tenant/domains/:id', 'domain'],
  ['DELETE', '/v1/tenant/domains/:id', 'domain'],
  ['POST', '/v1/tenant/domains/:id/verify', 'domain'],
  // create is the one account method that ignores the pin — list/get/update/remove all honour it
  ['POST', '/v1/accounts'],
]

/**
 * The live /v1 route table, minus everything deliberately exempted.
 *
 * Hono records middleware and sub-app mounts as method `ALL` on a wildcard path (`/v1/*` from the
 * auth guard, `/v1/partner/*` from the mount). Those are not endpoints and cannot be manifested.
 * Dropping them is safe because no HANDLER is registered with `app.all()` — asserted below, since
 * `ALL` on a concrete path is a shape this codebase already uses for rate-limit middleware and so
 * would read as normal — and because Hono merges a mounted sub-app's concrete routes into this same
 * table. `mountsExposeTheirRoutes` checks the second half only for mounts that leave a wildcard
 * record behind (`app.route('/v1/auth', …)` leaves none), so treat it as a tripwire for the mount
 * shape we have, not a general proof that merging happened.
 */
function unexemptedRoutes(app: { routes: { method: string; path: string }[] }): string[] {
  return app.routes
    .filter((r) => r.method !== 'ALL' && r.path.startsWith('/v1/') && !EXEMPT_PREFIXES.test(r.path))
    .map((r) => `${r.method} ${r.path}`)
    .filter((r) => EXEMPT_ROUTES[r] === undefined)
}

/** Every `ALL /prefix/*` mount must have at least one concrete route under it — see above. */
function mountsExposeTheirRoutes(app: { routes: { method: string; path: string }[] }): string[] {
  const concrete = app.routes.filter((r) => r.method !== 'ALL')
  return app.routes
    .filter((r) => r.method === 'ALL' && r.path.endsWith('/*') && r.path !== '/v1/*')
    .map((r) => r.path.slice(0, -1))
    .filter((prefix) => !concrete.some((r) => r.path.startsWith(prefix)))
}

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
    accountPrefs: f.accounts[0], // PATCH /v1/accounts/:id/preferences — the :id is an account
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
    driver: f.driverId,
    maintenance: f.maintenanceId,
    serviceLog: f.serviceLogId,
    document: f.documentId,
    maintenancePlan: f.maintenancePlanId,
    scheduledReport: f.scheduledReportId,
    share: f.shareId,
    gdpr: f.deviceId, // /v1/devices/:id/erase — the :id is a device
    sms: f.deviceId, // POST /v1/devices/:id/sms — the :id is a device (cross-tenant → 404 before any send)
    tenant: f.id,
    // action routes hung off a PARENT resource: the entity names what the route creates, the :id
    // names what it hangs off. See PARAM_ENTITY.
    exportOnAccount: f.accounts[0],
    commandOnDevice: f.deviceId,
    quarantine: '356307042440000', // a real 15-digit IMEI for the claim path param
    // affiliate/commission are PLATFORM-scoped (no tenant fixture) — any non-empty UUID makes the
    // path match so the tsp_admin RBAC gate fires (403) BEFORE the handler ever looks the id up
    affiliate: '00000000-0000-0000-0000-0000000000a1',
    commission: '00000000-0000-0000-0000-0000000000c1',
    deal_registration: '00000000-0000-0000-0000-0000000000d1',
  }
  return map[entity] ?? ''
}
/**
 * Routes whose `:id` is NOT an id of the route's own `entity`.
 *
 * `entity` is load-bearing for authz — it keys WRITE_POLICY in crud.ts — so these entries cannot be
 * renamed in the manifest to make `idFor` line up. The manifest is right and the test lookup has to
 * bend. Getting this wrong does not fail; it passes VACUOUSLY, because an id of the wrong KIND
 * matches no row in any tenant and the 404 arrives before the scope predicate is ever consulted:
 * `/v1/accounts/<exportJobUuid>/export` finds no such account anywhere, and `toBigId('<uuid>')`
 * returns null for `/v1/devices/<commandUuid>/commands` before `devices.get` runs at all. Delete
 * every tenant predicate in the codebase and both assertions still pass green.
 */
const PARAM_ENTITY: Record<string, string> = {
  // keyed on METHOD + path, not path alone: `/v1/devices/:id/commands` is BOTH a GET (entity
  // `device`) and a POST (entity `command`), and a path-only key would rewrite the id kind for both.
  // Harmless for this pair — they resolve to the same fixture id — but the next such pair would
  // silently mis-key one of them into exactly the vacuous pass described above.
  'POST /v1/accounts/:id/export': 'exportOnAccount',
  'POST /v1/devices/:id/commands': 'commandOnDevice',
  // tracking settings: manifested entity 'command' (so WRITE_POLICY gates it as a write), but the
  // :id is a DEVICE. Without this the sweep sent a command UUID, toBigId returned null, and the
  // 404 arrived before any tenant predicate ran — the vacuous pass described above.
  'POST /v1/devices/:id/settings': 'commandOnDevice',
  'POST /v1/devices/:id/settings/refresh': 'commandOnDevice',
  // CAN element priorities: same shape — manifested entity 'command' (a write on hardware), :id is a DEVICE
  'POST /v1/devices/:id/can-elements': 'commandOnDevice',
  // FLEET-1: the log/document routes hang off the DEVICE — the :id is a device id
  'GET /v1/devices/:id/service-log': 'device',
  'POST /v1/devices/:id/service-log': 'device',
  'GET /v1/devices/:id/documents': 'device',
  'POST /v1/devices/:id/documents': 'device',
}
const paramEntity = (m: { method: string; path: string; entity: string }): string =>
  PARAM_ENTITY[`${m.method.toUpperCase()} ${m.path}`] ?? m.entity

/**
 * Collection entities whose rows have no id to check for, and why — so that a NEW collection entity
 * without a fixture id fails loudly instead of joining them in silence.
 */
const COLLECTIONS_WITHOUT_ID: Record<string, string> = {
  branding: 'GET /v1/tenant/branding returns a single object, and its scope is the JWT tenant — there is no foreign id it could contain. branding.spec.ts:112 covers it',
  usage: 'daily aggregate rows carry no id; the tenant predicate is asserted directly below',
  webhookDelivery: 'covered by webhooks.spec.ts:142, which seeds a delivery in each tenant and compares the lists',
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
      const rid = idFor(fx.t2, paramEntity(m))
      // A missing fixture id used to make this test VACUOUS rather than red: `idFor` returned '',
      // `itemPath` produced `/v1/accounts//preferences`, and Hono answered 404 from the ROUTER —
      // the handler was never reached, the scope check never ran, and the assertion passed anyway.
      // The suite's promise is that a new endpoint is auto-covered; that only holds if a new entity
      // without a seeded id fails loudly here (found by review of the accountPrefs route).
      expect(rid, `no fixture id for entity '${m.entity}' — add one to idFor, or ${m.path} is untested`).not.toBe('')
      const path = itemPath(m.path, rid)
      const res = await req(path, fx.t1.tokenTenant, m.method.toUpperCase())
      expect(res.status, `${m.method} ${path} as T1`).toBe(404)
    }
  })

  it('every scoped collection GET: T1 list never contains a T2 resource id', async () => {
    const collections = fx.manifest.filter((m) => m.shape === 'collection' && m.method === 'get' && m.scopeClass !== 'platform')
    for (const m of collections) {
      const res = await req(m.path, fx.t1.tokenTenant)
      expect(res.status).toBe(200)
      // The item loop guards against a missing fixture id; this loop did not, and the same vacuity
      // applies with none of the noise: `idFor` returns '', no row has an id of '', the assertion
      // passes, and a whole collection route is untested while showing green.
      const rid = idFor(fx.t2, m.entity)
      expect(rid !== '' || COLLECTIONS_WITHOUT_ID[m.entity] !== undefined,
        `no fixture id for collection entity '${m.entity}' — seed one, or record in COLLECTIONS_WITHOUT_ID why ${m.path} cannot be id-checked`).toBe(true)
      if (rid === '') continue
      const body = (await res.json()) as unknown[] | { id?: string }[]
      // A `{items, nextCursor}` envelope would make `Array.isArray` false and silently empty the id
      // set — §6.6 mandates cursor pagination, so assert the shape rather than degrade to a no-op.
      expect(Array.isArray(body), `${m.path} is declared shape:'collection' but did not return an array — the leak check below would be a no-op`).toBe(true)
      const ids = new Set((body as { id?: string }[]).map((r) => String(r.id)))
      expect(ids.has(rid), `${m.path} leaked T2 ${m.entity}`).toBe(false)
    }
  })

  it('platform routes: a tenant admin (non-platform_admin) → 403', async () => {
    const platform = fx.manifest.filter((m) => m.scopeClass === 'platform')
    expect(platform.length).toBeGreaterThan(0)
    for (const m of platform) {
      const path = itemPath(m.path, idFor(fx.t2, paramEntity(m)))
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
      const res = await req(itemPath(m.path, idFor(fx.t1, paramEntity(m))), fx.t1.tokenTenant)
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

  it('geofences: an A1 account_manager can READ a tenant-shared fence but cannot MUTATE it (PATCH/DELETE → 404, review MED)', async () => {
    const shared = fx.t1.geofenceSharedId
    const authJson = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })
    // an account-scoped caller must NOT alter/redraw or delete a tenant-shared fence — that would
    // disable enforcement for every sibling account in the tenant (cross-account sabotage). It is
    // READABLE (enumerable id) but the mutation must match zero rows → 404.
    const patch = await fetch(`${fx.baseUrl}/v1/geofences/${shared}`, { method: 'PATCH', headers: authJson(fx.t1.tokenAccountA1), body: JSON.stringify({ name: 'hijacked' }) })
    expect(patch.status).toBe(404)
    const del = await fetch(`${fx.baseUrl}/v1/geofences/${shared}`, { method: 'DELETE', headers: { authorization: `Bearer ${fx.t1.tokenAccountA1}` } })
    expect(del.status).toBe(404)
    // positive controls: the account_manager CAN mutate its OWN fence, and a tenant admin CAN mutate the shared one
    const own = await fetch(`${fx.baseUrl}/v1/geofences/${fx.t1.geofenceId}`, { method: 'PATCH', headers: authJson(fx.t1.tokenAccountA1), body: JSON.stringify({ name: 'own-renamed' }) })
    expect(own.status).toBe(200)
    const admin = await fetch(`${fx.baseUrl}/v1/geofences/${shared}`, { method: 'PATCH', headers: authJson(fx.t1.tokenTenant), body: JSON.stringify({ name: 'admin-renamed' }) })
    expect(admin.status).toBe(200)
  })

  it('account time zone is settable and validated — the setting reports actually bucket by', async () => {
    // Two different "time zones" exist in the product and looked identical in the UI: this one (the
    // ACCOUNT's, which the server buckets report days by — hard rule 7) and the browser display
    // preference. The account one was pinned to UTC at signup with no screen to change it, so a
    // customer could set the display zone, watch every timestamp go local, and still get reports
    // cut on UTC midnight.
    const authJson = { authorization: `Bearer ${fx.t1.tokenTenant}`, 'content-type': 'application/json' }
    const [acct] = fx.t1.accounts
    const ok = await fetch(`${fx.baseUrl}/v1/accounts/${acct}`, { method: 'PATCH', headers: authJson, body: JSON.stringify({ timezone: 'Europe/Warsaw' }) })
    expect(ok.status).toBe(200)
    const saved = (await ok.json()) as { timezone?: string }
    expect(saved.timezone).toBe('Europe/Warsaw')
    // …and a zone Intl cannot resolve is refused, not stored — it would throw at every report render
    const bad = await fetch(`${fx.baseUrl}/v1/accounts/${acct}`, { method: 'PATCH', headers: authJson, body: JSON.stringify({ timezone: 'Mars/Olympus' }) })
    expect(bad.status).toBe(400)
  })

  it('account language + units: an account_manager may set them, and CANNOT reach a sibling account', async () => {
    // The preferences route is deliberately wider than `PATCH /v1/accounts/:id` — the operator who
    // reads the alerts picks the units they arrive in — so the scope check is what carries the whole
    // weight here. It is the same `findScoped` the rest of the repo uses; this proves it.
    const [a1, a2] = fx.t1.accounts
    const hdr = (tok: string) => ({ authorization: `Bearer ${tok}`, 'content-type': 'application/json' })
    const patch = (id: string | undefined, tok: string, body: unknown) =>
      fetch(`${fx.baseUrl}/v1/accounts/${id}/preferences`, { method: 'PATCH', headers: hdr(tok), body: JSON.stringify(body) })

    const own = await patch(a1, fx.t1.tokenAccountA1, { locale: 'lt', unitDistance: 'mi' })
    expect(own.status).toBe(200)
    expect(await own.json()).toMatchObject({ locale: 'lt', unitDistance: 'mi', unitSpeed: 'kmh' })

    // a sibling account is invisible, not merely unwritable
    expect((await patch(a2, fx.t1.tokenAccountA1, { locale: 'de' })).status).toBe(404)
    // …and a viewer may not write its own account's units either
    expect((await patch(a1, fx.t1.tokenViewerA1, { locale: 'de' })).status).toBe(403)
    // an unknown unit is refused rather than stored — nothing downstream would render it
    expect((await patch(a1, fx.t1.tokenTenant, { unitDistance: 'furlongs' })).status).toBe(400)
    // and the narrow schema means this route can never rename an account or move its report boundary
    const sneak = await patch(a1, fx.t1.tokenAccountA1, { name: 'renamed', timezone: 'Mars/Olympus' })
    expect(sneak.status).toBe(400)
  })

  it('audit: an ACCOUNT-SCOPED tenant admin is refused (403) — audit_log has no account partition', async () => {
    // REGRESSION (audit MED): `READ_POLICY.audit = TENANT_ADMINS` assumed every tenant admin is
    // tenant-WIDE — an assumption written into scope.ts but never enforced. `POST /v1/users`
    // accepts `{role:'tsp_admin', accountId}`, canGrantRole allows it, and scopeOf pins them. Every
    // other repo honours the pin via scopedWhere; `audit.list` filters on tenantId ALONE because
    // audit_log has no accountId column, so such an admin read the WHOLE tenant's trail — sibling
    // accounts' device names, user emails, geofence changes. The suite covered the ROLE dimension
    // (viewer/account_manager → 403) and never the scope one, so the gap was untested.
    expect((await req('/v1/audit', fx.t1.tokenAccountAdminA1)).status).toBe(403)
    expect((await req(`/v1/audit/${fx.t1.auditId}`, fx.t1.tokenAccountAdminA1)).status).toBe(403)
    // …and a genuinely tenant-wide admin still reads it
    expect((await req('/v1/audit', fx.t1.tokenTenant)).status).toBe(200)
  })

  it('every TENANT-WIDE surface refuses an account-pinned admin — not just the two that were fixed', async () => {
    // The audit test above fixed `audit`, and `usage` got the same line. Three MORE surfaces of the
    // identical shape were left on a role-only gate, and they are the expensive ones:
    //   · POST /v1/billing/portal returned a live Stripe Customer Portal URL for the TENANT's
    //     customer — the reseller's invoices, payment method and cancel button — to one end-
    //     customer's admin. /checkout let them open a subscription on it.
    //   · DELETE /v1/tenant/domains/:id removed the tenant's VERIFIED white-label host, taking every
    //     sibling account's login page and on-demand certificate down with it.
    //   · PATCH /v1/tenant/branding rewrote the product name, logo and colours every sibling
    //     account's users see, pre-auth and in branded mail.
    // What made this survivable for so long is that both dimensions were tested separately and
    // neither alone is red: billing.spec/branding.spec test the ROLE axis (viewer → 403), and the
    // manifest sweep tests the TENANT axis with an unpinned admin. Nothing crossed them.
    // collected, not asserted per-route: when this list grows the interesting output is EVERY
    // surface still open, not whichever one happens to sort first.
    const open: string[] = []
    for (const [method, path, entity] of TENANT_WIDE_ONLY) {
      const target = entity === undefined ? path : itemPath(path, idFor(fx.t1, entity))
      const res = await req(target, fx.t1.tokenAccountAdminA1, method)
      if (res.status !== 403) open.push(`${method} ${target} → ${res.status}`)
    }
    expect(open, 'these tenant-wide surfaces still accept an account-pinned admin').toEqual([])
    // …and the same routes still work for a genuinely tenant-wide admin, so the 403s above are the
    // pin and not a blanket breakage.
    for (const path of ['/v1/billing', '/v1/tenant/domains', '/v1/usage']) {
      expect((await req(path, fx.t1.tokenTenant)).status, `tenant-wide admin on ${path}`).toBe(200)
    }
    // GET /v1/tenant/branding is deliberately NOT in the list: READ_POLICY.branding is every role
    // ("viewers see the theme") and the payload has no per-account data, so gating it would blank
    // the UI theme for every account-scoped user to defend nothing.
    expect((await req('/v1/tenant/branding', fx.t1.tokenAccountAdminA1)).status).toBe(200)
  })

  it('POSITIVE CONTROL: an in-scope empty PATCH still 200s on every generic-repo entity', async () => {
    // The cross-tenant assertions above PATCH `{}` and expect 404. If an empty patch 404s for the
    // OWNER too, those assertions pass for the wrong reason and stop proving anything about scope —
    // which is exactly what happened when the generic repo moved to `updateMany` (it returns
    // count 0 for empty `data` where `update` returned the row). This is the control that catches it.
    const authJson = { authorization: `Bearer ${fx.t1.tokenTenant}`, 'content-type': 'application/json' }
    for (const path of [`/v1/webhooks/${fx.t1.webhookId}`, `/v1/rules/${fx.t1.ruleId}`, `/v1/scheduled-reports/${fx.t1.scheduledReportId}`]) {
      const res = await fetch(`${fx.baseUrl}${path}`, { method: 'PATCH', headers: authJson, body: '{}' })
      expect(res.status, path).toBe(200)
    }
  })

  it('webhooks: an A1 account_manager can READ a tenant-shared webhook but cannot MUTATE it (audit high)', async () => {
    // REGRESSION: createGenericRepo built ONE scoped predicate from the READ scope and used it for
    // the mutate pre-check too, then issued `update({ where: { id } })` with no scope at all.
    // Webhooks are registered `nullableAccount: true`, so an account-scoped tenant admin could
    // re-point or delete a TENANT-SHARED hook it merely had visibility of — and the worker loads
    // webhooks with `accountId = $1 OR accountId IS NULL` for every device, so a re-pointed shared
    // hook streamed every SIBLING account's events (device ids, kinds, geofence names, timestamps)
    // to the attacker's URL. Creation was already pinned, so it could be hijacked but not created.
    const shared = fx.t1.webhookSharedId
    const authJson = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })
    const list = (await (await req('/v1/webhooks', fx.t1.tokenAccountAdminA1)).json()) as { id: string }[]
    expect(list.map((w) => w.id)).toContain(shared) // readable — that is the whole trap

    const patch = await fetch(`${fx.baseUrl}/v1/webhooks/${shared}`, { method: 'PATCH', headers: authJson(fx.t1.tokenAccountAdminA1), body: JSON.stringify({ url: 'https://attacker.test/collect' }) })
    expect(patch.status).toBe(404)
    const del = await fetch(`${fx.baseUrl}/v1/webhooks/${shared}`, { method: 'DELETE', headers: { authorization: `Bearer ${fx.t1.tokenAccountAdminA1}` } })
    expect(del.status).toBe(404)
    // the row is untouched — not merely "the response said 404"
    const after = (await (await req(`/v1/webhooks/${shared}`, fx.t1.tokenTenant)).json()) as { url: string }
    expect(after.url).toBe('https://shared.test/h')
    // positive controls: own-account mutation works, and a tenant admin CAN mutate the shared one
    const own = await fetch(`${fx.baseUrl}/v1/webhooks/${fx.t1.webhookId}`, { method: 'PATCH', headers: authJson(fx.t1.tokenAccountAdminA1), body: JSON.stringify({ url: 'https://x.test/renamed' }) })
    expect(own.status).toBe(200)
    const admin = await fetch(`${fx.baseUrl}/v1/webhooks/${shared}`, { method: 'PATCH', headers: authJson(fx.t1.tokenTenant), body: JSON.stringify({ url: 'https://shared.test/h2' }) })
    expect(admin.status).toBe(200)
    // …and the PATCH response must not carry the PLAINTEXT HMAC signing secret (rule 12):
    // `readRedact` masked it on list/get, but this path returned the row straight from the write
    expect(((await admin.json()) as { secret: string }).secret).toBe('***')
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

  it('driver-scores is tenant-scoped: T1 never sees a T2 driver (V2)', async () => {
    const rows = (await (await req('/v1/driver-scores', fx.t1.tokenTenant)).json()) as { driverId: string }[]
    expect(Array.isArray(rows)).toBe(true)
    const ids = rows.map((r) => r.driverId)
    expect(ids).toContain(fx.t1.driverId) // own tenant's driver present
    expect(ids).not.toContain(fx.t2.driverId) // never another tenant's
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
    // NOTE: the filter is `path.startsWith('/v1/')`, so this harness structurally cannot see a
    // route outside /v1 — the public short link `/r/:code` is the first one. Adding it to the
    // exemptions would read as "considered and exempted" while changing nothing; it is covered by
    // its own tests in apps/api/__tests__/partner.spec.ts instead.
    const manifested = new Set(fx.manifest.map((m) => `${m.method.toUpperCase()} ${m.path}`))
    const missing = unexemptedRoutes(app as never).filter((r) => !manifested.has(r))
    expect(missing, 'these live routes are not in the manifest — register them, or add an EXEMPT_ROUTES entry saying which spec covers them').toEqual([])
    expect(mountsExposeTheirRoutes(app as never), 'a sub-app mount contributed no concrete routes — its whole subtree is now invisible to this test').toEqual([])
    // `unexemptedRoutes` drops every method-ALL record as middleware. That is only sound while no
    // HANDLER uses `app.all()` on a concrete path — and the codebase already has ALL records on
    // concrete paths (the rate-limit middleware on /v1/public/*), so the shape is not exotic here.
    // Without this, `app.all('/v1/anything', handler)` is invisible to the meta-test AND to the
    // isolation sweep at once.
    const concreteAll = (app.routes as { method: string; path: string }[])
      .filter((r) => r.method === 'ALL' && !r.path.endsWith('/*') && !EXEMPT_PREFIXES.test(r.path))
      .map((r) => r.path)
    expect(concreteAll, 'a method-ALL record on a concrete /v1 path: if that is a handler it is untested; if it is middleware, exempt its path explicitly').toEqual([])
  })

  it('every EXEMPT_ROUTES entry still exists — a stale exemption silently un-covers its successor', () => {
    const app = createApp({
      redis: {} as never, redisSub: {} as never, db: {} as never,
      jwtSecret: 'x'.repeat(32), jwtTtlS: 900, refreshTtlS: 3600,
      lockout: { maxFails: 5, windowS: 900 }, secureCookies: false, trustProxy: false,
    })
    // An exemption that outlives its route is worse than none: rename `/v1/billing/portal` to
    // `/v1/billing/manage` and the old key sits there looking deliberate while the new route is
    // simply unlisted — and the reader of the list believes billing is accounted for.
    const live = new Set((app.routes as { method: string; path: string }[]).map((r) => `${r.method} ${r.path}`))
    const stale = Object.keys(EXEMPT_ROUTES).filter((r) => !live.has(r))
    expect(stale, 'these exemptions name routes that no longer exist — delete them').toEqual([])
  })

  it('detects a route added OUTSIDE the manifest (probe) — including under an exempted sibling', () => {
    const app = createApp({
      redis: {} as never, redisSub: {} as never, db: {} as never,
      jwtSecret: 'x'.repeat(32), jwtTtlS: 900, refreshTtlS: 3600,
      lockout: { maxFails: 5, windowS: 900 }, secureCookies: false, trustProxy: false,
    })
    // The bare `/v1/sneaky` case only ever proved the filter runs at all. The cases that MATTER are
    // the ones the old prefix regex swallowed: a new route whose neighbour is exempt. Each of these
    // is a plausible next feature — send a test payload to a webhook, rotate a key without minting a
    // new one, expose an invoice list, a per-account usage breakdown — and each is tenant data.
    for (const p of ['/v1/sneaky', '/v1/webhooks/:id/test', '/v1/api-keys/:id/rotate', '/v1/billing/invoices', '/v1/reports/:type/schedule', '/v1/push/broadcast', '/v1/driver-scores/:id']) {
      app.get(p, (c) => c.json({}))
    }
    const manifested = new Set(fx.manifest.map((m) => `${m.method.toUpperCase()} ${m.path}`))
    const caught = unexemptedRoutes(app as never).filter((r) => !manifested.has(r))
    expect(caught).toEqual([
      'GET /v1/sneaky',
      'GET /v1/webhooks/:id/test',
      'GET /v1/api-keys/:id/rotate',
      'GET /v1/billing/invoices',
      'GET /v1/reports/:type/schedule',
      'GET /v1/push/broadcast',
      'GET /v1/driver-scores/:id',
    ])
  })
})
