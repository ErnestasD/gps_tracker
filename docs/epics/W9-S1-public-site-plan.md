# W9-S1 Plan — Public web: apps/site iš orbetra_design + pilot-request API

> PROJECT_PLAN Round 12: „Public marketing site added as Lovable-built `apps/site` (PUBLIC_WEB_LOVABLE.md) — same stack, zero CC time except review". Founder paprašė prijungti public webą (2026-07-13). Autonominė sesija.

## Kontekstas

`orbetra_design/` (untracked, Lovable) — TanStack **Start** + bun + `@lovable.dev/vite-tanstack-config` (nitro, cloudflare target). Mūsų stack'ui reikia: statinio Vite SPA be jokio serverio runtime (Caddy file_server). Routes jau naudoja gryną `@tanstack/react-router` `createFileRoute` + `head()` — veikia klientinėje pusėje su `HeadContent`. Puslapiai: index, pricing, tsp, pilot, **legal pack** (dpa/impressum/privacy/subprocessors/terms — W8 S1 dalis jau dizaine!). ~3.5k eilučių site komponentų.

## Sprendimai

1. **apps/site = švarus Vite SPA** (React 18, TS, Tailwind v4, `@tanstack/react-router` + `router-plugin` file-based routegen — be Start/nitro/bun/@lovable.dev). Kopijuojame `src/{components,routes,lib,styles}` iš orbetra_design; išmetame: server.ts, start.ts, lovable-error-reporting, sitemap[.]xml.ts (→ statinis public/sitemap.xml + robots.txt). `__root.tsx`: paliekam HeadContent, išmetam `Scripts` (Start-only) + Lovable error reporting.
2. **orbetra_design LIEKA** kaip Lovable dizaino šaltinis (founder gali toliau iteruoti; sync į apps/site — rankinis su peržiūra). apps/site tampa build'inama tiesa.
3. **PilotForm wiring**: POST `${VITE_API_URL|same-origin}/v1/public/pilot-request` {name, company, email, phone?, deviceCount, message, ref} + honeypot laukas + `tc_ref` cookie (60 d, iš `?ref=`, po consent — spec'e non-essential cookie → vieno sakinio notice).
4. **API endpoint** (E09 dalis, be jo forma mirusi): `POST /v1/public/pilot-request` — PUBLIC (prieš auth, EXEMPT isolation), zod schema, honeypot laukas (užpildytas → 200 fake-ok, nieko nesaugom), rate limit per IP (Redis INCR 5/val kaip caddy-ask pattern), `Lead` lentelė (append-only migracija: name/company/email/phone/deviceCount/message/ref/createdAt). Platform_admin GET /v1/platform/leads (skaitymui — manifest route). Metrika nereikalinga V1.
5. **Kalbų selektorius** (žinomas stub'as): IŠIMAM iš Footer — EN-only iki W8 S3 i18n pass (sąžininga vs neveikiantis mygtukas). Dokumentuota.
6. **Deps (ADR-022)**: framer-motion + maplibre-gl (spec'o sankcionuoti; cobe pakeistas maplibre — spec leidžia), @fontsource ×3, lucide-react, naudojami radix'ai, @number-flow/react (founder'io dizaino pasirinkimas Lovable'e — dokumentuojama ADR'e). Viskas MIT.
7. **Serving**: statinis dist. Caddy: (a) staging IP bloke `/site/*` preview (vite `base: '/site/'`? — NE: base keitimas laužo absoliučius kelius dizaine; vietoj to `handle_path /site/*` + file_server su try_files SPA fallback ir build be base — asset keliai absoliutūs / … problema). PAPRASČIAU: site servinamas atskiru HOST'u kai bus DNS (`ORBETRA_SITE_HOST`), o staging preview — per :8080 Caddy listener (UFW atidarom 8080) su file_server. Dist į serverį patenka su rsync (image nereikia — statinis).
8. **Umami**: env stub (VITE_UMAMI_URL/ID) — script tag tik kai abu set'inti (self-hosted Umami dar nėra — follow-up).

## Failai

**Nauji:** apps/site/* (package.json, vite.config.ts, tsconfig, index.html, src iš dizaino, public/{robots.txt,sitemap.xml}); packages/db migracija `leads` + repos/leads.ts (create UNSCOPED public + platformList); api routes/pilotRequest.ts (public, rate-limited) + manifest GET /v1/platform/leads; docs/adr/022-site-deps.md; docs/epics/W9-S1-public-site-plan.md.
**Keičiami:** infra/Caddyfile (site host block + staging :8080 preview), infra/compose/docker-compose.apps.yml (caddy port + dist mount), pnpm-workspace (apps/* jau dengia), turbo (generic), tests/isolation (EXEMPT pilot-request; platform/leads manifest auto), README, runbook.

## Testai

- **api pilotRequest.spec**: valid POST → 201 + lead row; honeypot → 200 be row; rate limit 6-as/val → 429; garbage body → 400; platform GET leads (platform_admin only — 403 tsp).
- **site unit (vitest)**: PilotForm submit shape (fetch mock) + honeypot laukas renderinamas hidden; tc_ref cookie helper pure testai.
- **build gate**: `vite build` CI'e (turbo test/typecheck/lint + build script).
- **isolation**: EXEMPT public route; /v1/platform/leads platform-gated auto.

## Verifikacija (DoD)

Gates žali; site build'as statinis be serverio; PilotForm end-to-end staging'e (POST → lead DB'e); legal puslapiai pasiekiami; rule 13 (OSM attribution jei map renderinasi), rule 10 ADR, rule 12 (jokių secrets).

## Rizikos

- **SEO be SSG**: SPA meta per HeadContent — Google renderina JS; SSG (vite prerender) = follow-up jei Lighthouse SEO <95.
- **Dizaino drift**: orbetra_design toliau gyvena Lovable — sync'ai rankiniai su peržiūra (AGENTS.md jau įspėja).
- **i18n**: EN-only kol W8 S3; selektorius išimtas, ne fake.
