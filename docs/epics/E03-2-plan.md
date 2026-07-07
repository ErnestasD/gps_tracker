# E03-2 Plan — Scoped repositories + isolation suite

> Kopijuojama į docs/epics/E03-2-plan.md. Story L; cut line: repo layer ‖ CRUD/UI. Autonominė sesija (founder AFK) — pilnas repo sluoksnis + izoliacijos stuburas + reprezentatyvūs CRUD endpoint'ai + Settings/Profile.

## Context

CLAUDE.md rule 2 / PROJECT_PLAN §6.2: VISA DB prieiga per `packages/db` scoped repositories; kiekvienas metodas ima explicit `Scope`; kryžminės izoliacijos suite CI-blocking nuo W3 amžinai. E03-1 paliko `createAuthDb` + `UNSCOPED_AUTH_METHODS` kaip repo sluoksnio sėklą. Dabar: `scope.ts`, pilnas repo sluoksnis, manifest-driven CRUD route'ai, izoliacijos suite (fixtures 2 tenants × 2 accounts × rolės, iteruoja route manifest'ą kryžmiškai → 403/404), meta-testai, lint-proof, CI wiring, Settings/Profile ekranas.

**AC:** [1] Settings/Profile ekranas (locale, theme, password change) · [2] izoliacijos suite žalia & CI-blocking · [3] route be manifest įrašo → suite krenta (meta-testas) · [4] joks failas už packages/db neimportuoja @prisma/client (lint-proof kaip testas).

## Architektūra

### packages/db repo sluoksnis
- **`src/scope.ts`**: `Scope = {tenantId: string; accountId?: string}`; `scopedWhere(scope, opts?)` — visada `tenantId`; jei `scope.accountId` — `accountId` equality (non-null modeliai) arba `accountId IN (acc, null)` (nullable-account modeliai: geofences/apiKeys/webhooks — tenant-level null matoma visiems tenant'o accountams; `opts.nullableAccount: true`). `NotInScopeError` klasė.
- **`src/db.ts`**: `createDb(url)` — VIENAS PrismaClient, grąžina `{tenants, accounts, users, devices, geofences, rules, events, apiKeys, webhooks, audit, auth, $disconnect}`. `createAuthDb` tampa plonu wrapper'iu virš `createDb(...).auth` (E03-1 main.ts/login.ts nekeičiami arba minimaliai).
- **`src/repos/*.ts`**: factory `createXRepo(prisma, audit)`. Metodai `list(scope, opts?)`, `get(scope, id)`, `create(scope, data)`, `update(scope, id, data)`, `delete(scope, id)`. get/update/delete naudoja `findFirst({where: {id, ...scopedWhere}})` → null jei ne scope'e (API → 404). Mutacijos rašo audit eilutę (before/after, userId) per audit repo. tenants repo — platform-only (be tenant scope; platform_admin guard API lygyje).
- Geofences geom — raw SQL (`ST_GeomFromGeoJSON`) create/update (Prisma `Unsupported`); list/get grąžina geom kaip GeoJSON per `ST_AsGeoJSON`.

### apps/api manifest-driven route'ai
- **`src/routes/registry.ts`**: `RouteDef = {method, path, scopeClass: 'public'|'tenant'|'account'|'platform', roles?: Role[], handler}`; `ROUTE_MANIFEST: RouteDef[]`; `mountRoutes(app, manifest, deps)` registruoja + taiko authMiddleware/requireRole pagal scopeClass. createApp naudoja registry — manifest ir registracija NEGALI išsiskirti.
- **Endpoint'ai (E03-2 shipina):** `/v1/accounts` (CRUD, tenant), `/v1/users` (CRUD, tenant+account), `/v1/geofences` (CRUD, account-nullable), `/v1/rules` (CRUD, account), `/v1/events` (GET list, account), `/v1/api-keys` (GET/POST/DELETE, tenant), `/v1/webhooks` (CRUD, tenant), `/v1/tenants` (CRUD, **platform_admin**), `POST /v1/auth/password` (change: verify current + argon2 set). ws-ticket/devices-last lieka (perkelti į manifest kaip account/tenant). Device CRUD/import/quarantine — E03-3 (manifest praplės).
- Visi zod-validuoti (packages/shared schemos), cursor pagination kur list, RFC7807.

### Izoliacijos suite (naujas workspace pkg `tests/isolation`)
- `tests/isolation/{package.json, vitest.config.ts, suite.spec.ts, prisma.spec.ts}`.
- **suite.spec.ts**: testcontainers pg (timescale image, prisma deploy pattern) + redis; fixtures 2 tenants × 2 accounts × user-per-role (per seedUser). Importuoja `ROUTE_MANIFEST` + `createApp`. Kiekvienam non-public route: tenant A user prieš tenant B resursą → 404; account-scoped user prieš kito account resursą → 404; ne-platform prieš platform route → 403. Manifest-driven → nauji endpoint'ai auto-padengti.
- **Meta-testas (AC[3])**: enumeruoja Hono `app.routes` → kiekvienas `/v1/*` (non-auth) route PRIVALO turėti manifest įrašą; unlisted → fail. Testas su probe: laikinai registruoja route be manifest → suite fiksuoja.
- **prisma.spec.ts (AC[4])**: grep repo (git ls-files) dėl `@prisma/client` importų už `packages/db/**` → tuščia. Naudoja `UNSCOPED_AUTH_METHODS` kaip exemption sąrašą dokumentuotai.
- **CI**: `tests/*` pridedama į root `vitest.config.mts` projects; `tests/isolation` turi `test` script → `turbo run test` pagauna (CI-blocking automatiškai); root `test:isolation` script (CLAUDE.md).

### Web Settings/Profile (AC[1])
- `apps/web/src/routes/app/settings.tsx`: locale select (i18n changeLanguage + localStorage), theme toggle (dark/light — tokens.css `.light` jau yra; `useTheme` store → `<html>` class + localStorage), password change forma (current+new → `POST /v1/auth/password`; 401 → wrong current). Sidebar Admin sekcija → Settings nav punktas aktyvuojamas.
- `lib/theme.ts` + `lib/prefs.ts` (localStorage persist). i18n raktai ×4.

## Failai (nauji)
packages/db/src/{scope.ts, db.ts, repos/{tenants,accounts,users,devices,geofences,rules,events,apiKeys,webhooks,audit,index}.ts}; packages/shared/src/entities.ts (CRUD zod schemos); apps/api/src/routes/{registry.ts, accounts.ts, users.ts, geofences.ts, rules.ts, events.ts, apiKeys.ts, webhooks.ts, tenants.ts, password.ts}; tests/isolation/{package.json, vitest.config.ts, suite.spec.ts, prisma.spec.ts, helpers.ts}; apps/web/src/{routes/app/settings.tsx, lib/{theme,prefs}.ts}; docs/epics/E03-2-plan.md.
Keičiami: packages/db/src/{auth.ts→wrap, index.ts}; apps/api/src/{app.ts→mountRoutes, index.ts, main.ts→createDb}; apps/web/{router.tsx +settings route, components/AppShell +nav, i18n×4}; root vitest.config.mts, package.json (test:isolation), README.

## Žingsniai
1. Branch `feat/e03-2-scoped-repos` (po E03-1 merge).
2. scope.ts + createDb + repos (+ unit testai per package db testcontainers) → gates.
3. shared entities schemos → api registry + endpoint'ai + password → gates (api testai).
4. tests/isolation pkg: fixtures + suite + meta + lint-proof → CI wiring → gates.
5. web Settings/Profile + theme/locale/password → gates + lokalus e2e (login→settings→change pw→relogin).
6. Docs → gates → adversarinė peržiūra (fokusas: scope leak — ar KIEKVIENAS get/update/delete tikrina scope; nullable-account semantika; audit userId; platform guard; manifest completeness; password change auth) → radiniai → PR → CI → merge → atmintis.

## Verifikacija (DoD)
- `pnpm test:isolation` žalia; suite CI-blocking (turbo test).
- Meta-testas: unlisted route → fail (įrodyta probe).
- Lint-proof: 0 @prisma/client už packages/db.
- Manual: 2 tenantai, cross-boundary curl → 404/403; Settings pw change → relogin nauju pw.
- §10 #7 (tenant leakage) — suite tai amžinai gaudo; PR nurodo.

## Rizikos
- Apimtis didelė — jei per didelė vienam PR, landinti repo sluoksnį + izoliacijos stuburą + accounts/users/geofences endpoint'us, likusius (rules/events/api-keys/webhooks) pažymėti follow-on tame pačiame epione (bet manifest+suite privalo dengti tik tai, kas registruota — savaime nuoseklu).
- Geom raw SQL — atsargiai su scope predikatais raw užklausose (tenantId param binding).
- createAuthDb refactor negali sulaužyti E03-1 auth testų (37) — paleisti po refactor.
