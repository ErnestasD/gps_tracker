# E03-6 Plan — Audit log on all mutations + Audit UI

> Story W3 S6 (PROJECT_PLAN §8). Autonominė sesija (founder: „varom"). Playbook: planas → kodas → gates → adversarinė peržiūra → PR → CI → merge → atmintis.

## Context

`audit_log` **rašymas jau veikia** nuo E03-2: kiekviena scoped mutacija per `AuditRepo.record` įrašo eilutę (who=userId, action, entity, entityId, before/after, at). Padengta: accounts/users/devices/rules/webhooks (per `createGenericRepo`), tenants, tenantDomains, branding. `events`/`profiles` — ne user-mutacijos (pipeline/seed). Trūksta: (1) **read API** auditui, (2) **Audit UI**, (3) **„on all mutations" meta-testas** (audit.ts komentaras jau žada „repo-manifest meta-test") kaip AC sargas.

**AC (PROJECT_PLAN §8 W3 S6):** `audit_log on all mutations`. Interpretacija: kiekviena mutuojanti repo operacija palieka audit eilutę (įrodyta meta-testu) + admin gali peržiūrėti auditą UI.

## Sprendimai

- **Read modelis**: audit yra **tenant-scoped** (`audit_log.tenantId`), jautrus → skaito tik **TENANT_ADMINS** (tsp_admin + platform_admin), kaip `domain`. `account_manager`/`viewer` — 403 (eilutės nėra account-scoped, tenant-wide).
- **AuditRepo.list(scope, opts)**: filtrai `entity?`, `action?`, `from?`/`to?` (data), cursor `id` (BigInt, desc), `take` (default 50, max 200). tenantId iš scope. Precedentas — `events.list` (cursor+take, BigInt id → string per `json()`).
- **Route'ai** (crud.ts manifest, scopeClass `tenant`, entity `audit`): `GET /v1/audit` (collection, query filtrai) + `GET /v1/audit/:id` (item). `READ_POLICY['audit']=TENANT_ADMINS`. Jokių write route'ų (auditas append-only, rašomas tik vidinis).
- **Meta-testas** (packages/db `__tests__/audit-coverage.spec.ts`, testcontainers pg): kiekvienai mutuojančiai repo (accounts/users/devices/rules/webhooks/tenants/tenantDomains/branding) create/update/delete → tikrina, kad atsiranda audit eilutė su teisingu entity+action. Tai AC „on all mutations" įrodymas + regresijos sargas (nauja repo be audito → raudona).
- **Web Audit puslapis** (`routes/app/audit.tsx`): lentelė — kada (Intl lokalus laikas), kas (userId trumpas + email jei resolvinam iš /v1/users), veiksmas, entity, entityId, išskleidžiamas before/after JSON diff. Filtrai: entity select, action select, data nuo/iki. Puslapiavimas: „Rodyti daugiau" (cursor). Admin-only nav.
- **Laikas**: Intl.DateTimeFormat (naršyklės tz) — auditas rodo lokalų laiką; **jokio naujo dep** (date-fns-tz būtų runtime dep → ADR rule 10). Trip/report kodui tz taisyklė (rule 7) galioja, auditui lokalus laikas OK.

## Failai

**Nauji:** `apps/web/src/{routes/app/audit.tsx, lib/audit.ts}`; `packages/db/__tests__/audit-coverage.spec.ts`; docs/epics/E03-6-plan.md.

**Keičiami:** `packages/db/src/repos/audit.ts` (+`list` metodas + `AuditRow`/`AuditListOpts` tipai); `apps/api/src/routes/crud.ts` (audit RouteDefs + READ_POLICY['audit']); `apps/web/src/{router.tsx (+audit route), components/AppShell.tsx (Admin→Audit nav + ikona), i18n×4}`; `tests/isolation/{fixtures.ts (seed+idFor audit), suite.spec.ts}` — audit item route auto-covered; `apps/web/tests/pw/smoke.spec.ts` (audit e2e); README (audit sekcija).

## Testai

- **audit-coverage.spec** (pg): kiekviena mutuojanti repo → audit eilutė (entity+action match). Įrodo AC.
- **api**: GET /v1/audit grąžina tik savo tenant eilutes, filtrai (entity/action), cursor puslapiavimas; account_manager/viewer → 403; cross-tenant :id → 404 (per isolation).
- **isolation**: audit item route (GET /v1/audit/:id) cross-tenant → 404; collection neturi kito tenant eilučių. Manifest meta-test auto-įtraukia.
- **web unit**: audit filtrų query string builder (jei atskiriama gryna funkcija).
- **e2e**: login (tsp_admin) → Audit puslapis → matomos eilutės (pvz. iš device create per e2e) → filtruoti pagal entity → before/after išskleidžiamas.

## Žingsniai

1. Branch `feat/e03-6-audit-ui`. Planas → docs/epics. ✅ (branch sukurtas)
2. audit.ts `list` + tipai → gates → audit-coverage.spec.
3. crud.ts audit route'ai + READ_POLICY → gates → api testas.
4. isolation fixtures/suite → žalia.
5. web lib/audit.ts + Audit puslapis + nav + i18n → gates → e2e.
6. README → pilni gates → adversarinė peržiūra (fokusas: audit tenant-scope leak, before/after nesukelia PII/secret leak — redactFields jau taiko webhooks secret; account_manager negali skaityti; cursor injection; BigInt serialization; append-only — jokio write/delete route) → radiniai → PR → CI → merge → atmintis.

## Verifikacija (DoD)

- Gates + isolation + e2e žali; audit-coverage.spec įrodo „on all mutations"; api testas įrodo scope + RBAC.
- Manual: Audit puslapyje matomos mutacijos, filtrai veikia, before/after rodo redaguotus secret'us kaip `***`.
- §10 #7 (tenant leak) — audit scoped `tenantId`, isolation auto.

## Rizikos

- **Secret leak per before/after**: webhooks secret jau redaguojamas (`redactFields` generic repo). Patikrinti, kad joks kitas jautrus laukas (password hash) nepatenka į audit snapshot — users repo neaudituoja password (patikrinti).
- **RBAC**: audit read tik TENANT_ADMINS; viewer/account_manager 403 (testas).
- **Append-only**: jokio POST/PATCH/DELETE /v1/audit — tik GET.
- **BigInt id**: cursor kaip string, serializacija per esamą `json()` (events precedentas).
