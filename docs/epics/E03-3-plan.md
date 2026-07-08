# E03-3 Plan — Device management: CRUD, profiles, bulk import

> Kopijuojama į docs/epics/E03-3-plan.md. Story M. Autonominė sesija (founder AFK, delegavo tęsti backlog'ą). Remiasi ant E03-2 scoped-repo + manifest pattern'o.

## Context

Iki šiol įrenginiai egzistuoja tik kaip dev-tooling Redis seed (`tools/simulator/src/seed.ts` — TEMPORARY iki E03-3). E03-3 duoda tikrą device CRUD per scoped repo + manifest route'us, ir — kritiškai — **sinchronizuoja Redis registrus, kuriuos skaito pipeline**: `registry:imei` (ingest handshake imei→deviceId), `device:tenant` + `device:account` (worker LiveState publish). Be šio sync tikras įrenginys neatpažįstamas. Taip pat: 4 device profiles seed, CSV bulk import su dry-run diff, retire→ingest-reject propagacija.

**AC:** [1] 1000-eilučių CSV dry-run <10 s su per-row klaidų ataskaita (blogas IMEI checksum, dublikatas, nežinomas profilis) · [2] retire device → ingest atmeta kitą connect (0x00) per 5 s (registry propagacijos testas).
**Edge:** IMEI su leading zeros — String visur.
**NOT here:** quarantine/claim flow (E03-4), device detail page + trips/history tabs, full shared DataTable komponentas (functional table dabar; §3 DataTable atidedamas kai daugiau puslapių jo prireiks).

## Sprendimai

- **Device id = BigInt autoincrement** (ne IMEI). Route'inam item'us pagal numerinį id (`/v1/devices/:id`), coercinam į BigInt repo lygyje. `registry:imei[imei] = <device.id>`; visas pipeline naudoja tą deviceId (bigint). Item route registruojamas PO `/v1/devices/last` (Hono match'ina registracijos tvarka — `last` neįkris į `:id`).
- **Repo lieka grynas DB** (packages/db). Redis registry sync — API sluoksnyje per `deviceRegistry` helper'į (`apps/api/src/routes/deviceRegistry.ts`): `activate(redis, {id, imei, tenantId, accountId})` = HSET 3 hash'ai; `deactivate(redis, {id, imei})` = HDEL registry:imei + device:tenant/account + DEL device:{id}:last. Handler kviečia po repo mutacijos. Best-effort su klaida paviršiuje jei Redis krenta (device DB'e, bet neaktyvus — dokumentuota; reconcile V2).
- **CSV parser hand-rolled** (RFC4180-ish: quoted fields, kableliai kabutėse, CRLF; ~40 eil., testuojamas) — be naujo dep. IMEI validacija = Luhn mod-10 + 15 skaitmenų.
- **Import route'ai per manifest** (RouteDef su custom handler): `POST /v1/devices/import/preview` (dry-run diff) + `POST /v1/devices/import` (apply). entity 'device', tenant scope, write policy. Meta-testas juos padengia automatiškai.

## Failai

**Nauji:**
- `packages/db/src/repos/devices.ts` — `createDeviceRepo(prisma, audit)`: list/get/create/update/retire; BigInt id coercion; `getByImei(scope, imei)` (dublikatų tikrinimui); tenantId+non-null accountId scope (kaip rules). Tipai į index.ts, `devices:` į Db + createDb.
- `packages/db/seed/profiles.ts` + root script `db:seed:profiles`: idempotent upsert 4 profilių (fmb1xx, fmc, fmb6xx-stub, tat-asset) su presenceRules/commandPresets/readIdleMin. Eksportuoja `seedProfiles()` (naudos e2e + isolation fixtures).
- `apps/api/src/routes/deviceRegistry.ts` — activate/deactivate Redis helper.
- `apps/api/src/routes/deviceImport.ts` — `parseCsv`, `luhnValid`, `dryRun(db, scope, rows)` → {create[], update[], errors[]}, `applyImport(db, redis, scope, actor, rows)`.
- `apps/web/src/routes/app/devices/index.tsx` — devices puslapis (list + create dialog + retire + import wizard). `apps/web/src/components/ui/{table,dialog}.tsx` (vendorinti shadcn), `apps/web/src/lib/devices.ts` (API klientas).
- `apps/api/__tests__/devices.spec.ts` (CRUD + registry sync + import dry-run/apply + retire propagacija), `packages/db/__tests__/devices.spec.ts` (BigInt scope) jei reikia.
- `docs/epics/E03-3-plan.md`, `docs/adr/020-...` NE (jokių naujų runtime dep).

**Keičiami:** `packages/db/src/{db.ts,index.ts}` (+devices repo); `apps/api/src/routes/crud.ts` (device RouteDefs — list/get/create/patch/retire + import; READ/WRITE_POLICY['device'] = tenant-admins write; `CrudDeps` +redis; import handlers); `apps/api/src/app.ts` (perduoti redis į buildRoutes; `/v1/devices/last` LIEKA); `apps/web/src/router.tsx` (+devices route) + `AppShell` (Fleet→Devices aktyvus); `tests/isolation/{fixtures.ts,suite.spec.ts}` (device fixture: seed profile + device per tenant; `idFor` +device); `apps/web` i18n ×4; README (device seed + import).

## Registry sync (pipeline kontraktas)

Create: repo.create → `activate`: `HSET registry:imei <imei> <id>`, `HSET device:tenant <id> <tenantId>`, `HSET device:account <id> <accountId>`.
Retire (PATCH retiredAt arba DELETE): repo.retire → `deactivate`: `HDEL registry:imei <imei>`, `HDEL device:tenant <id>`, `HDEL device:account <id>`, `DEL device:{id}:last`. → ingest `lookup` grąžina null → 0x00 kitam connect (AC[2]).

## Izoliacijos suite (auto-coverage)

Pridėjus device RouteDefs į manifestą, suite automatiškai testuoja cross-tenant item→404, collection GET no-leak, RBAC. Reikia tik: `fixtures.ts` seed'inti profilį + device'ą per tenant (per createDb.devices.create + registry sync nebūtinas suite'ui — jis testuoja DB scope), `idFor` +`device: f.deviceId`, TenantFixture +deviceId. Import POST cross-tenant dengiamas RBAC (viewer/account_manager negali).

## Testai

- **api devices.spec** (pg+redis testcontainers): CRUD scope; create → registry:imei/device:tenant/device:account HSET (assert Redis); retire → HDEL (AC[2] mechanizmas: lookup→null); import dry-run 1000 eilučių <10 s + per-row klaidos (Luhn, dup-in-file, dup-in-db, unknown profile); apply kuria + sync'ina; leading-zero IMEI išsaugomas String.
- **db**: BigInt scope get/update (cross-scope id→null).
- **isolation**: device routes auto (cross-tenant 404, RBAC).
- **e2e smoke**: login → Devices puslapis → create device → matomas sąraše → retire; + AC[2] integracija: sukurti device per API → simulator connect (accepted) → retire per API → simulator reconnect (rejected 0x00, `rejectedByImei:true`).
- **web unit**: devices API klientas (list/create/retire), CSV parse jei web-side (dry-run rodomas iš serverio).

## Žingsniai

1. Branch `feat/e03-3-devices` (po E03-2 merge — merged). Planas → docs/epics.
2. packages/db: devices repo + profiles seed + db.ts/index → gates + db testai.
3. api: deviceRegistry + crud device routes + deviceImport + policy + redis threading → gates + devices.spec (testcontainers).
4. tests/isolation: device fixture + idFor → suite žalia.
5. web: shadcn table/dialog + devices puslapis + route + nav + i18n → gates.
6. e2e: devices flow + retire→reject → lokalus pnpm e2e.
7. Docs → gates → adversarinė peržiūra (fokusas: registry sync teisingumas ir atomiškumas DB↔Redis, BigInt scope leak, import dry-run klaidų pilnumas + injection, retire propagacija, RBAC, /v1/devices/last vs /:id routing) → radiniai → PR → CI → merge → atmintis.

## Verifikacija (DoD)

- Pilni gates + isolation + e2e žali; devices.spec įrodo registry sync + import dry-run <10 s.
- Manual: `pnpm db:seed:profiles` → sukurti device UI → simulator tuo IMEI connect'ina (accepted) → retire → reconnect rejected.
- §10 #7 (tenant leak) — isolation auto; #4 (unknown/invalid) — import validacija + quarantine (E03-4).

## Rizikos

- **DB↔Redis atomiškumo trūkumas**: create DB ok, Redis sync fail → neaktyvus device. Best-effort + klaida; reconcile V2. Retire svarbesnis (saugumas) — jei HDEL fail, device lieka aktyvus; retry/log.
- **BigInt id route parsing** — coercinti atsargiai (NaN/overflow → 404, ne 500).
- **CSV parser edge cases** — testuoti quoted/CRLF/tuščias; 1000-row perf.
- **Import scope** — account_manager import'as tik į savo account; tenant-wide validuoja account priklausymą (kaip rules create).
