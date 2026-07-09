# E06-5 Plan — OpenAPI docs page

> W6 S5. PROJECT_PLAN §6.6 ("OpenAPI served at /v1/openapi.json"). Autonominė sesija. LAST core W6 story.

## Context

API turi daug /v1 route'ų (manifest-driven CRUD + auth + reports + api-keys + webhooks). Integracijoms reikia OpenAPI dokumento (§6.6). Planas minėjo Scalar/Stoplight embed — bet tai bundle/dep (ADR). Manifestas (buildRoutes→ManifestEntry[]) JAU aprašo route'us → generuojam OpenAPI iš jo (no drift).

## Sprendimai

- **`apps/api/src/openapi.ts`** `buildOpenApi(manifest, serverUrl)` → OpenAPI 3.1: info, servers, tags (per entity), paths iš manifesto (:id→{id}, path params) + curated non-manifest (auth login/refresh/logout, ws-ticket, devices/last, reports/{type}, api-keys×3). securitySchemes: bearerAuth (http bearer JWT) + apiKeyAuth (apiKey header X-Api-Key). GET→[bearer,apiKey]; write→[bearer]; login→[] public.
- **`apps/api/src/routes/docs.ts`** `mountDocs(app, {manifest, serverUrl?})` — GET /v1/openapi.json (public, cache 300s) + GET /v1/docs (self-contained HTML, NO external CDN/CSP-safe, fetch spec + list per tag, DOM via textContent/createElement — jokio innerHTML). manifest paduodamas (ne import apiManifest → circular).
- **app.ts** mountDocs PRIEŠ authMiddleware (public); serverUrl iš PUBLIC_API_URL env. EXEMPT isolation meta-test (openapi.json|docs ×2).

## Failai

**Nauji:** apps/api/src/openapi.ts; apps/api/src/routes/docs.ts; apps/api/__tests__/openapi.spec.ts; docs/epics/E06-5-plan.md.
**Keičiami:** apps/api/src/app.ts (mountDocs + import); tests/isolation/suite.spec.ts (EXEMPT); README.

## Testai (6, pure — no container)

buildOpenApi(apiManifest()): 3.1 + 2 securitySchemes; **covers EVERY manifest route** (drift guard); curated routes (auth/reports/api-keys); GET=[bearer,apiKey] write=[bearer]; login public []; :id→{id}.

## Verifikacija (DoD)

Gates + 6 testų žali. Spec generuotas iš manifesto → cannot drift. Docs XSS-safe (textContent, server-gen content). Public routes (docs neturi secrets; endpoint list = standard OpenAPI).

## Rizikos

- **CSP**: /v1/docs inline `<script>` — jei API globaliai setintų strict CSP script-src 'self', block. v1 docs page — priimtina; nonce jei reikės. Note.
- **Info leak**: spec rodo visus route paths (įsk admin) neautentifikuotam — standard OpenAPI (nėra secrets/schemas su sensitive). Priimtina.
- **Scalar/Stoplight richer UI** = follow-up (bundle ADR). Dabar self-contained minimal renderer + raw JSON (import į Postman).
