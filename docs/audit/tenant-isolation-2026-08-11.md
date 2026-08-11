# Module 2 audit — tenant isolation (2026-08-11)

Second module of the priority programme (module 1: `ingest-path-2026-08-10.md`). Same method:
**three independent hostile audits on distinct angles → three independent verifiers instructed to
REFUTE**, default REFUTED when uncertain. Then one hostile review of the resulting diff, told that
five of this author's last six fixes were rejected.

Angles: (1) the isolation suite's own blind spots, (2) the `packages/db` scoping layer, (3) the API
authz layer.

## Status

| # | Finding | Verdict | State |
|---|---|---|---|
| 1 | Account-pinned `tsp_admin` reaches tenant-wide surfaces (billing, branding, domains, accounts-create) | **CONFIRMED HIGH** (executed) | **FIXED** |
| 2 | Retired device blocks an IMEI against every other tenant forever; no rate limit; no admin remedy | **CONFIRMED HIGH** (executed) | **OPEN — needs a product decision, see below** |
| 3 | Isolation suite: prefix exemptions swallow whole subtrees; two vacuous item assertions; unguarded collection loop | CONFIRMED (measured) | **FIXED** |
| 4 | `usage.tenantSummary` takes a `Scope` and honours half of it | REFUTED as a leak — guard at `crud.ts:1236`; but the guard was **untested** | **FIXED** (test) |
| 5 | `webhook_deliveries.accountId` nullable + read with `nullableAccount` | LATENT (auditor's proof was a mock, not an insert) | **FIXED** |
| 6 | `generic.ts` create spreads caller data over the scope stamp | LATENT — blocked only by schema hygiene in another package | **FIXED** (1 line) |
| 7 | Push subscription cross-account takeover | **REFUTED** | — |
| 8 | `readDriverScores` LEFT JOIN missing a tenant predicate | **REFUTED** | — |
| 9 | `NotInScopeError` declared as the create defence and never thrown | **REFUTED** (all 17 create paths validate) | — |
| 10 | Bare-PK writes after a scoped pre-check (4 repos) | LATENT — nothing can move a row between tenants today | deferred |
| 11 | API keys have no expiry | **REFUTED** — preference, not defect | — |
| 12 | Read-only API key can spend routing quota | REFUTED as authz; **real as cost** — see note | deferred |

## Finding #1 — the pin is a boundary the product enforces, and three surfaces ignored it

`POST /v1/users` accepts `{role:'tsp_admin', accountId:<uuid>}`; `canGrantRole('tsp_admin',
'tsp_admin')` is true; `login.ts` emits the `acc` claim whenever `user.accountId !== null`, with no
role condition. So an admin **pinned to one account** is a principal the API creates on request.

Every repo honours that pin through `scopedWhere`. Four surfaces do not, because their data has no
`accountId` column to be scoped by — and they gated on role alone. A verifier tasked with refuting
this executed the whole chain against real containers:

- `POST /v1/users {role:'tsp_admin', accountId}` → **201**
- login → JWT with `"acc":"28f4e833-…"`, `"role":"tsp_admin"`
- control: `GET /v1/audit` → 403, `GET /v1/usage` → 403 — the pin *is* enforced elsewhere
- `POST /v1/billing/portal` → **200** `{"url":"https://portal.test/cus_<tenant>"}` — a Stripe
  Customer Portal session for the **reseller's** customer: invoices, payment method, cancel button
- `DELETE /v1/tenant/domains/:id` → **200** — the tenant's verified white-label host, gone
- `PATCH /v1/tenant/branding {productName:'PWNED'}` → **200**, visible to every sibling account

Review then found a fifth: `POST /v1/accounts` — `accounts.create` writes `tenantId` from the scope
and ignores `scope.accountId`, unlike every other method on that repo. Proven live (**201**, tenant
account count 2 → 3). Pollution rather than privesc: `listWhere` means the creator can neither see
nor manage what they made, and `POST /v1/users` forces their own pin so they cannot populate it.

**What made this survivable.** Both dimensions were tested — separately. `billing.spec`/
`branding.spec` test the ROLE axis (viewer → 403); the manifest sweep tests the TENANT axis with an
*unpinned* admin. Nothing crossed them. The suite's own exemption comment even read
*"tenant-wide Stripe state — billing.spec.ts"*, and `billing.spec.ts` had no pinned-principal test.

**Fixed:** `isTenantWideAdmin` in `billing.ts` (4 call sites), `tenantWide(c)` on `PATCH
/v1/tenant/branding`, all five `/v1/tenant/domains` routes, and `POST /v1/accounts`.

**Deliberately NOT gated:** `GET /v1/tenant/branding`. `READ_POLICY.branding` is every role on
purpose ("viewers see the theme") and the payload carries no per-account data — gating it would
blank the UI theme for every account-scoped user to defend nothing.

**Locked by:** `TENANT_WIDE_ONLY` in `tests/isolation/suite.spec.ts`. Against `main` it reports
**11 of 14** routes open, including `DELETE /v1/tenant/domains/:id → 200`.

**Known UX consequence, not addressed here:** `AppShell.tsx` computes `isAdmin` from role alone, so
a pinned admin still sees Billing and Branding in the sidebar and gets a raw untranslated
`domains are tenant-wide` detail string. No shipped flow creates such a principal (every path that
mints a `tsp_admin` writes `accountId: null` explicitly, and `apps/web` never calls `/v1/users`), so
this is cosmetic for a configuration only a hand-made API call produces.

## Finding #2 — OPEN. The IMEI squat, and the product question behind it

The auditor framed this as a cross-tenant existence oracle. The verifier **re-scoped it**: the
oracle is LOW (IMEIs are printed on device labels, and a 409 never reveals *which* tenant holds it).
The load-bearing harm is the **squat**, and it was measured:

```
1. tenant A creates IMEI            -> OK       countActive(A) = 1
2. tenant A retires it              -> OK       countActive(A) = 0   <-- plan slot FREED
3. tenant B creates the same IMEI   -> DuplicateImeiError -> 409     <-- block SURVIVES on a retired row
6. create->retire loop x25          -> squatted = 25, countActive(A) = 1
7. tenant B tries all 25            -> blocked 25/25
```

Because `countActive` filters `retiredAt: null` (`devices.ts:104`) while the cross-tenant `held`
predicate does not (`devices.ts:141-151`), retiring frees the plan slot **and keeps the block**. The
cap denominator never grows, so the squat is free and unbounded.

Compounding facts, each verified:
- **No rate limit** on `POST /v1/devices` or `/v1/devices/import`. Every `fixedWindowCount` call site
  in the API was enumerated; none covers device creation. `MAX_IMPORT_ROWS = 1000`.
- **No admin remedy.** `POST /v1/quarantine/:imei/claim` routes through the same `devices.create` →
  409. Deleting the squatting tenant fails: `devices_accountId_fkey` is RESTRICT, so
  `db.tenants.remove` errors with P2003. Release requires manual SQL.
- **Reachable from a free trial.** `direct_10` self-serve signup is enough.
- IMEI = 8-digit TAC + 6-digit serial; `deviceCreateSchema` is `/^\d{15}$/` with no Luhn check, so
  one Teltonika model's TAC is a 10⁶ space.

### Why this is not fixed in this PR

A rate limit is the obvious move and it is **not sufficient**: targeted squatting needs a few hundred
specific IMEIs, not a million. The real fix changes **IMEI ownership semantics**, and that is a
product decision with revenue and support consequences, not an engineering one:

- **(a) Age out the block.** Allow another tenant to claim an IMEI whose blocking row has been
  retired for more than N days. Matches how resold GPS hardware actually moves. Cost: a tenant who
  retires a tracker temporarily (unit in for repair) can have it sniped, and the oracle tells an
  attacker exactly when. Needs a value for N.
- **(b) Require evidence of possession.** A device that has never reported should not hold an IMEI
  against another tenant. Principled — the block is held by possession, not by registration. Cost:
  pre-provisioned devices (registered before the tracker ships) lose their block if retired first.
- **(c) Keep the block permanent, bound the abuse.** Per-tenant rate limit on device creation plus a
  metric and an alert on a tenant creating devices that never report, plus a platform-admin release
  path for a retired holder. Cost: does nothing against targeted squatting of a known fleet.

**Question for the founder:** does a retired IMEI ever become claimable by another company, and after
how long? Everything else follows from that answer. (c) is safe to ship immediately regardless and is
worth doing even if (a) or (b) is chosen.

## Finding #3 — what the isolation suite was actually asserting

Measured against the live route table rather than argued:

- The EXEMPT regex was a list of **prefixes**, and exempted **51 routes**. Five of them — the entire
  webhook CRUD — are in the manifest anyway, so the exemption covered nothing today while reserving
  cover for anything added under `/v1/webhooks/*` later. The bare `webhooks` alternative was written
  for `POST /v1/webhooks/ses` and swallowed its neighbourhood; the now-dead `webhooks\/ses`
  alternative next to it is the proof the author intended narrow and wrote broad.
- A probe of seven plausible next routes (`/v1/webhooks/:id/test`, `/v1/api-keys/:id/rotate`,
  `/v1/billing/invoices`, …) is caught **1 of 7** by the old regex, **7 of 7** by the new one.
- Two item assertions were **vacuous**: `POST /v1/accounts/:id/export` was fed an export-job UUID
  where `:id` is an account, and `POST /v1/devices/:id/commands` a command UUID where `:id` is a
  device BigInt. Both 404 on the *kind* of the id before any scope predicate runs — review confirmed
  by running: identical 404 cross-tenant and own-tenant, i.e. the tenant predicate was never
  consulted. Delete every scope filter in the codebase and both stayed green.
- The collection loop had no missing-id guard (the item loop has one), so `branding`, `usage` and
  `webhookDelivery` leak-checked against `''`.

**Fixed:** exact-path `EXEMPT_ROUTES` with a reason and a spec reference per entry, a staleness test
(an exemption that outlives its route is worse than none — it reads as deliberate while its successor
is uncovered), `PARAM_ENTITY` keyed on METHOD+path, a collection-loop guard with a documented
opt-out, an `Array.isArray` assertion (a `{items, nextCursor}` envelope would silently empty the id
set, and §6.6 mandates cursor pagination), and a check that no handler uses `app.all()` on a concrete
path — the codebase already has method-`ALL` records on concrete `/v1/public/*` paths, so that shape
would read as normal.

## Findings #4–#6 — small and real

- **#4** `usage.tenantSummary` is guarded at the route, and the guard had **no test**: the only
  RBAC coverage used `account_manager` and `viewer`, both of whom `READ_POLICY.usage` already stops
  at the middleware. Now in `TENANT_WIDE_ONLY`.
- **#5** `webhook_deliveries` now scopes strictly. Unlike geofences/webhooks/api-keys, a null account
  here has no "tenant-shared" meaning: the worker stamps every row with the account of the device
  whose event fired it and drops the row rather than write an unattributed one — verified directly in
  `webhookWorker.ts`/`deliveryLog.ts`, not taken on report. `nullableAccount` would have broadcast
  any future anomaly to every account in the tenant; it now fails closed. `DeliveryRow.accountId` is
  narrowed to `string` so the invariant is structural rather than resting on one early return.
  The api fixture that seeded a NULL row was seeding a shape the writer cannot produce.
- **#6** `generic.ts` create now spreads the scope stamp **last**. Zero behavioural change today —
  the three schemas that reach it are plain `z.object`, which strips unknown keys — but the tenant of
  a new row no longer depends on schema hygiene in another package.

## Refuted, with the evidence that killed each

- **Push takeover.** The re-home succeeds (tenant-only predicate), but the upsert also overwrites
  `p256dh`/`auth` with the attacker's keys, and RFC 8291 binds the ciphertext to that key pair. The
  verifier ran the project's own `web-push` + `http_ece`: attacker keys decrypt, **the victim's
  browser fails** with `Unsupported state or unable to authenticate data`. Nobody receives the
  payload. The endpoint URL is also unobtainable — the single read-out surface is the GDPR export,
  pinned to one account and `TENANT_ADMINS`-only. And narrowing the predicate would resurrect a
  documented availability bug (`push.spec.ts:132-155`). No change.
- **Driver-scores JOIN.** Cross-tenant binding is impossible: auto-attribution reads
  `driver:ibutton:{tenantId}:{accountId}` keyed on the trip's own scope, manual assignment pins to
  the **trip's** tenant+account, recompute copies `driverId` only within one `deviceId`, and drivers
  cannot change account. Style, not a bug.
- **`NotInScopeError`.** All 17 accountId-bearing create paths validate at the call site. Dead code,
  not a hole. (Worth deleting or actually throwing — the comment currently lies.)
- **Bare-PK writes.** No code path moves a row between tenants; no `data` payload carries `tenantId`;
  `DeviceUpdate`/`DriverUpdate` have no `accountId` at all. LATENT. Would be armed by any future
  "move device/user to another account" feature.
- **Worker writers outside `packages/db`.** Traced end to end and clean: `positions` carries no
  tenant column at all, every writer of `device:tenant`/`device:account` sources the value from a DB
  row, a device's owner is immutable so the cache cannot go stale in a harmful direction, and every
  unresolvable scope fails closed.

## Cost note, not an isolation finding

`POST /v1/routing/optimize` is **not** self-hosted OSRM any more — `pickEngine` prefers Mapbox
whenever `MAPBOX_TOKEN` is set (ADR-034 supersedes the routing half of ADR-029; **CLAUDE.md rule 13
is stale on this point**). It is metered: free to 100k/mo, ~$200/mo at 200k. The only ceiling is
per-principal (30/min ≈ 43k/day), it fails open on a Redis blip, there is no per-tenant or global
quota, and there is **no cap on API keys per tenant** — so one admin can mint N keys and multiply the
ceiling N×. One sustained key is ~1.3M requests/month ≈ $1.3k. The fix is a tenant/global counter
plus an alert on Mapbox call volume, not a role gate.

## Structural gaps left open

- **Cross-ACCOUNT is not manifest-driven.** The manifest carries `scopeClass: 'account'` on ~50
  routes and nothing loops over them: every manifest sweep uses `tokenTenant`, a tenant-wide admin.
  The account boundary is asserted by hand for accounts, rules, geofences, webhooks, prefs and audit
  only, and the fixtures seed A2-owned copies of just **two** entities (`ruleA2Id`, `geofenceA2Id`).
  Devices, drivers, maintenance, trips, events, commands, shares, scheduled reports and exports have
  no cross-account assertion. All are correct today via `scopedWhere` — but cross-account is the
  boundary that has actually broken here twice (shared geofence, shared webhook), and on a
  white-label TSP two accounts are two unrelated companies. Closing this means seeding A2 copies of
  every entity, then one automatic loop.
- **Collection POSTs are exercised by nothing.** They fail the item filter (`shape !== 'item'`) and
  the collection filter (`method !== 'get'`). That is every route accepting a body-carried
  `accountId`/`deviceId` — the classic cross-tenant *write* vector. Each was read and each validates;
  the code resists, the suite does not test it. The one create with no test anywhere is a CSV import
  naming another tenant's `accountId`.
- **The empty body defangs the write assertion.** `req()` sends `'{}'`, so a cross-tenant PATCH is
  stopped by the scoped `findFirst` pre-check and never reaches the write. The suite proves the
  pre-check is scoped, never that the write is.
- **Manifest metadata is never validated.** The meta-test compares route *strings* only. Declaring
  `shape: 'collection'` on a POST makes a route 100% untested while showing green — the root cause of
  every vacuity above.
