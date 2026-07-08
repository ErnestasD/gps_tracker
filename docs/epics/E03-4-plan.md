# E03-4 Plan — Quarantine & claim flow

> Kopijuojama į docs/epics/E03-4-plan.md. Story M (maža — reuse E03-3). Autonominė sesija (founder delegavo tęsti).

## Context

Ingest jau karantininuoja nežinomus IMEI: `handleImei` (session.ts) kviečia `registry.quarantine(imei)` → `ZADD quarantine:imei <nowMs> <imei>` + `INCR quarantine:rejects:{imei}` (TTL 1 h), atsako 0x00, ≥3/h → uždaro socket. Bet nėra būdo platform_admin'ui pamatyti šį sąrašą ir „prisiimti" (claim) įrenginį. E03-4 duoda: platform_admin quarantine sąrašas + claim (assign tenant+account+profile) → device create (E03-3 kelias) → registry set → kitas connect priimamas. Quarantine yra PLATFORM-lygio (nežinomi IMEI neturi tenant'o).

**AC:** [1] e2e: nežinomas simulator IMEI connect'ina (atmestas) → atsiranda quarantine <5 s → claim → reconnect priimtas → duomenys teka · [2] non-platform_admin nemato quarantine (role testas).

## Sprendimai (reuse E03-3)

- **Claim = device create TARGET tenant'o scope'e** (ne admin'o!): `scope = {tenantId: body.tenantId}`; `db.devices.create(scope, {userId: admin}, {...})` (su DuplicateImeiError→409 kaip E03-3) → `activateDevice(redis, {...})` → `ZREM quarantine:imei imei` + `DEL quarantine:rejects:{imei}`. Audit userId = platform admin'o (AuditLog.userId neturi FK — cross-tenant ok).
- **Platform admin'ui reikia matyti target tenant'o account'us** claim dialoge → naujas `GET /v1/tenants/:id/accounts` (platform; `db.accounts.list({tenantId: pathId})`). Profiliai iš esamo `/v1/profiles`.
- **Route'ai per manifestą** (crud.ts buildRoutes, entity 'quarantine', scopeClass 'platform' → auto platform_admin guard + isolation 403 testas). Quarantine state — Redis (deps.redis handler'yje, jau yra CrudDeps).

## Failai

**Nauji:** `apps/api/src/routes/quarantine.ts` — `listQuarantine(redis)` (ZREVRANGE WITHSCORES → [{imei, lastSeenMs, rejects}] su pipeline GET counterių) + `claimDevice` helper (reuse). `packages/shared`: `quarantineClaimSchema` ({tenantId, accountId, profileId, name}). `apps/web/src/routes/app/devices/quarantine.tsx` — Quarantine sekcija (platform_admin-only, claim dialogas: tenant→account→profile pickers). `apps/api/__tests__/quarantine.spec.ts`.

**Keičiami:** `apps/api/src/routes/crud.ts` (+3 RouteDefs: GET /v1/quarantine, POST /v1/quarantine/:imei/claim, GET /v1/tenants/:id/accounts; READ/WRITE_POLICY nereikia — platform); `apps/web/src/routes/app/devices/index.tsx` (+Quarantine sekcija jei role=platform_admin) + `lib/devices.ts` (listQuarantine, claim, listTenants, listTenantAccounts); `tests/isolation/suite.spec.ts` (itemPath generalizuoti — pakeisti bet kokį `:param`; idFor +quarantine → žinomas imei; flag iš peržiūros); `apps/web` i18n ×4; `apps/web/tests/pw/{global-setup,smoke}.ts` (seed platform_admin + quarantine e2e); README.

## Testai

- **quarantine.spec** (pg+redis testcontainers): ZADD imei → GET /v1/quarantine (platform token) rodo su rejects/lastSeen; non-platform → 403; claim → device sukurtas TARGET tenant'e + activateDevice (registry:imei set) + ZREM (nebe quarantine); claim dup IMEI → 409; tenant/account validacija.
- **isolation**: quarantine platform routes auto 403 (+ itemPath fix).
- **e2e smoke**: seed platform_admin; nežinomas IMEI (pvz 356307042449500) → simulator connect (exit 1, rejected) → login kaip platform_admin → Quarantine sekcija rodo IMEI → claim į E2E tenant/account/profile → reconnect (exit 0, accepted). AC[1] pilna grandinė.

## Žingsniai

1. Branch `feat/e03-4-quarantine`. Planas → docs/epics.
2. shared schema → api quarantine.ts + crud RouteDefs (quarantine + tenant-accounts) → gates + quarantine.spec.
3. isolation itemPath/idFor fix → suite žalia.
4. web Quarantine sekcija + role gating + lib → gates.
5. e2e (platform_admin seed + quarantine flow) → lokalus e2e.
6. Docs → gates → adversarinė peržiūra (fokusas: claim cross-tenant scope teisingumas — ar admin gali claim'inti į BET KURĮ tenant; ar account/profile validuojami target tenant'e; ZREM idempotentiškumas; role gating web'e; DuplicateImeiError; quarantine spoof-flood 10k cap) → radiniai → PR → CI → merge → atmintis.

## Verifikacija (DoD)

- Gates + isolation + e2e žali; quarantine.spec įrodo claim→registry→ZREM; AC[2] role 403.
- Manual: unknown IMEI sim → quarantine UI → claim → reconnect accepted.
- §10 #4 (unknown IMEI) — quarantine+claim uždaro; #7 — platform scope izoliuotas (admin claim'ina tik nurodytą tenant, account validuojamas).

## Rizikos

- **Claim cross-tenant scope**: admin nurodo tenantId — patikrinti kad account priklauso TAM tenant'ui (db.accounts.get({tenantId: body.tenantId}, accountId)), ne admin'o. Kritinė vieta peržiūrai.
- **itemPath :imei** — generalizuoti, kad izoliacijos platform testas hit'intų realų path.
- **Race**: IMEI nebe quarantine claim metu — vis tiek kuria device (ZREM idempotent). OK.
- **Redis fail claim metu** — device sukurtas + activate, bet ZREM fail → IMEI lieka quarantine sąraše (nekenksminga, dingsta kai zset persipildo arba retry). Best-effort.
