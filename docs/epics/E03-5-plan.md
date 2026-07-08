# E03-5 Plan — White-label: branding + custom domains + on-demand TLS

> Kopijuojama į docs/epics/E03-5-plan.md. Story M. Autonominė sesija (founder delegavo).

## Context

Tenant modelis jau turi `branding` jsonb ir `TenantDomain` lentelę (verified + txtToken, migruota). Caddyfile jau turi `on_demand_tls { ask http://api:3010/v1/internal/caddy-ask }`. Trūksta: (1) tsp_admin galimybės redaguoti SAVO tenant'o branding + valdyti domenus, (2) DNS TXT verify, (3) Caddy ask endpoint'o (public, rate-limited), (4) public `/v1/branding` by Host pre-login logotipui, (5) web theming (branding → CSS vars + WCAG contrast fallback + logo), (6) el. laiško branded layout. Dalis TLS/domenų — infra-only (tikri domenai/DNS/:443 tik staging).

**AC:** [1] du demo tenantai dviejuose domenuose rodo skirtingą logo/spalvas/vardą (Playwright — lokaliai per Host-spoof /v1/branding; pilna 2-domenų TLS staging) · [2] ask endpoint atmeta nežinomą domeną (testas) + rate-limited · [3] emails render tenant name+logo (snapshot testas).

## Sprendimai

- **Tenant-self route'ai** (tsp_admin/platform_admin, tenant iš auth.tenantId — NIEKADA path param): `GET/PATCH /v1/tenant/branding` (branding-only schema), `GET/POST/DELETE /v1/tenant/domains`, `POST /v1/tenant/domains/:id/verify`. scopeClass 'tenant', entity 'branding'/'domain'. Domain :id operacijos ownership-checked (priklauso auth.tenantId). Manifeste → izoliacijos suite auto-covers.
- **Public route'ai** (prieš authMiddleware, EXEMPT manifeste): `GET /v1/branding` (Host header → tenant_domains verified → tenant.branding, arba default), `GET /v1/internal/caddy-ask?domain=` (verified tenant_domain → 200, kitaip 403; rate-limit 10/min/IP per Redis INCR kaip lockout).
- **DNS TXT verify**: `node:dns` `resolveTxt` (be dep). Verify route ieško `orbetra-verify=<txtToken>` TXT įrašuose → verified=true. **Injectable resolver** (ApiDeps.resolveTxt? default node:dns) — testai mock'ina (CI be tikro DNS).
- **db**: naujas `tenantDomains` repo (scoped: list/create/get/delete/verify per tenant + `findVerifiedByDomain` ask'ui). Branding update per `TenantRepo.updateBranding(actor, tenantId, branding)` (naujas self metodas, restricted branding-only).
- **Cert status**: BE migracijos — rodom domain būseną pending(neverified)/verified + pastaba „sertifikatas išduodamas automatiškai per Caddy pirmo HTTPS hit metu". Caddy admin API cert-issued patikra — V2.
- **Web theming**: `lib/branding.ts` — `applyBranding(branding)`: `documentElement.style.setProperty('--accent', primary)` / `--accent-2` su WCAG AA contrast fallback (jei fail prieš surface → auto-lighten 15%); logo swap. Po login fetch `GET /v1/tenant/branding` (authed) → apply. Public Host branding — pre-login (staging).
- **Email**: `packages/shared` arba `apps/api/src/email/layout.ts` — `renderBrandedEmail(branding, {subject, body})` → HTML su name+logo. Snapshot testas (AC[3]). Pilnas send = E05-4.
- **Infra**: Caddyfile — pridėti on-demand HTTPS site block (`https:// { tls { on_demand } reverse_proxy web:5173 / api:3010/v1 }`). Dokumentuota; staging-only (compose neturi api service lokaliai).

## Failai

**Nauji:** `packages/db/src/repos/tenantDomains.ts` (+TenantRepo.updateBranding); `apps/api/src/routes/{tenantSelf.ts (branding+domains handlers), caddyAsk.ts (ask + public branding + rate-limit)}`; `apps/api/src/email/layout.ts` + snapshot testas; `packages/shared`: brandingSchema, domainCreateSchema; `apps/web/src/{lib/branding.ts, routes/app/branding.tsx}`; `apps/api/__tests__/{branding.spec.ts, caddyAsk.spec.ts}`; docs/epics/E03-5-plan.md.

**Keičiami:** `apps/api/src/{app.ts (register public branding+caddy-ask BEFORE authMiddleware; mount tenantSelf routes via manifest), routes/crud.ts (tenant-self RouteDefs) arba naujas routes modulis + index}`; `packages/db/src/{db.ts (+tenantDomains repo), index.ts}`; `apps/web/src/{router.tsx (+branding route), components/AppShell.tsx (Admin→Branding aktyvus), routes/app/map.tsx arba app.tsx (apply branding po login), i18n×4}`; `tests/isolation/suite.spec.ts` (EXEMPT +branding +internal/caddy-ask); `infra/Caddyfile` (HTTPS site block); README.

## Testai

- **branding.spec** (pg+redis): PATCH /v1/tenant/branding (tsp_admin savo tenant) → GET rodo; cross-tenant negalima (auth.tenantId); domain add → txtToken; verify su MOCK resolver (match → verified=true; no-match → 400); domain ownership (kito tenant domain :id → 404); public GET /v1/branding su Host=domain1 → tenant1 branding, Host=domain2 → tenant2, nežinomas Host → default.
- **caddyAsk.spec**: verified domain → 200; unverified/unknown → 403; rate-limit 11-as per IP → 429; be domain param → 400.
- **email**: renderBrandedEmail snapshot (name+logo+spalva).
- **isolation**: tenant-self branding/domain routes auto (cross-tenant); public routes EXEMPT.
- **web unit**: applyBranding setProperty + contrast fallback (pilkas ant surface → auto-lighten); logo.
- **e2e smoke**: login → Branding puslapis → keisti productName+primary → live preview atsinaujina (CSS var pasikeitė); domain add rodo TXT instrukciją. (2-domenų TLS — staging, dokumentuota.)

## Žingsniai

1. Branch `feat/e03-5-whitelabel`. Planas → docs/epics.
2. shared schemos → db tenantDomains repo + updateBranding → gates.
3. api tenantSelf + caddyAsk + public branding + email layout + registracija → gates + branding/caddyAsk spec.
4. isolation EXEMPT/manifest → suite žalia.
5. web branding.ts + Branding puslapis + apply po login + nav → gates + e2e.
6. infra Caddyfile HTTPS block + docs → gates → adversarinė peržiūra (fokusas: branding XSS — logoUrl/CSS injection į setProperty; tenant-self niekada netrust path param; caddy-ask rate-limit apėjimas per XFF; DNS verify spoofing; domain ownership; public branding Host injection; WCAG contrast; email HTML injection) → radiniai → PR → CI → merge → atmintis.

## Verifikacija (DoD)

- Gates + isolation + e2e žali; branding.spec įrodo scoped branding + Host resolution; caddyAsk 200/403/429; email snapshot.
- Manual: Branding puslapyje keisti spalvą → UI persidažo; domain add → TXT; caddy-ask curl su verified domain → 200.
- §10 #7 (tenant leak) — branding/domains scoped (auth.tenantId), isolation auto; public branding tik verified domenams.

## Rizikos

- **XSS/CSS injection**: branding.primary/accent eina į `setProperty('--accent', value)` — validuoti kaip hex/rgb (zod regex), ne laisvas string (kitaip `red;} body{...}` ar `url(javascript:)`). logoUrl — validuoti https URL, render kaip src (ne innerHTML). Email — escape'inti name. KRITINĖ vieta.
- **caddy-ask rate-limit XFF**: kaip lockout — rightmost XFF su trustProxy, kitaip socket addr.
- **DNS verify spoof**: tik txtToken match (CSPRNG) — negalima atspėti. Resolver injectable testams.
- **Infra e2e ribos**: 2-domenų TLS negalima lokaliai — Host-spoof /v1/branding įrodo mechanizmą; pilna staging patikra dokumentuota.
- **Naming**: Caddyfile hardcode'ina /v1/internal/caddy-ask — derinti (ne /v1/branding kaip plane).
