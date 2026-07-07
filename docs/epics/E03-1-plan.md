# E03-1 Plan — Auth & RBAC

> Implementacijos pradžioje kopijuojama į `docs/epics/E03-1-plan.md`. Founder sprendimai (2026-07-07): **(1)** ambiguous login → 409; **(2)** vienas PR (atominis AuthStub pakeitimas).

## Context

W2 baigtas su story-sankcionuotu auth stub'u (`AuthStub` api'juje, sessionStorage tokenas web'e — abu pažymėti „E03-1 ištrina"). E03-1 pastato tikrą auth: argon2id slaptažodžiai, 15 min access JWT + rotuojantis refresh (httpOnly cookie, family invalidation on reuse), 4 rolės, `requireRole` middleware, progressive lockout (§6.1 ops-normative). Prisma schemoje `users` + `Role` enum JAU yra (E01-3); trūksta refresh-token lentelės, auth lib'ų ir viso runtime kodo. E03-2 (scoped repos + isolation suite) statys ant šitų pamatų.

**AC:** [1] refresh reuse po rotacijos → visa family atšaukta (testas) · [2] rolių matricos testas: 4 rolės × reprezentatyvūs endpoint'ai → 200/403 · [3] argon2 parametrai asertinti teste (prieš tylų silpninimą).
**NOT here:** password reset (manual by admin, v1), host-based tenant rezoliucija (E03-5), scoped repo sluoksnis (E03-2).

## Sprendimai (Plan agento validuoti)

- **Lib'ai (→ ADR-019):** `@node-rs/argon2` (prebuilt napi — NEreikia keisti root `onlyBuiltDependencies`; dep apps/api + devDep packages/db seed'ui) · JWT = **`hono/jwt` built-in** (HS256, zero naujų dep) · cookies = `hono/cookie` · sha256 = node:crypto. apps/api gauna `@orbetra/db` workspace dep (pirmas api DB dep — ADR'e paminėti; `DATABASE_URL` tampa privalomas).
- **Refresh šeimos:** nauja Prisma `RefreshToken` lentelė (id, familyId, userId FK cascade, tokenHash sha256 UNIQUE, expiresAt, createdAt, rotatedAt?, revokedAt?; indeksai familyId/userId). Append-only migracija. Kodėl sha256, ne argon2: 256-bit CSPRNG tokenas — offline brute force neįmanomas; hash'as turi būti deterministinis (unique lookup) ir pigus; precedentas — ApiKey.hash schemoje.
- **Rotacija (race-safe):** atominis claim — `updateManyAndReturn` (`SET rotatedAt=now() WHERE tokenHash=$h AND rotatedAt IS NULL AND revokedAt IS NULL AND expiresAt>now() RETURNING`); 0 eilučių → jei row egzistuoja su rotatedAt/revokedAt ⇒ **reuse** → `revokeFamily` + clear cookie + 401; laimėjus → naujas tokenas TOJE PAČIOJE family, sliding expiry (+REFRESH_TTL). Dvi lygiagrečios refresh → viena laimi, kita numarina family (AC[1] griežtumas; web single-flight tai daro reta; grace-window = dokumentuotas V2).
- **Cookie:** `orb_refresh`; HttpOnly; SameSite=Strict; **Path=/v1/auth** (niekada nekeliauja su duomenų užklausom); Max-Age=REFRESH_TTL; Secure pagal env flag (dev/e2e http). Same-origin mandatas (Vite proxy / Caddy) — README pastaba, kad split-origin nepalaikomas v1.
- **JWT claims:** `{sub, ten, acc?, role, iat, exp, iss:'orbetra-api'}`, HS256 su JWT_SECRET, TTL 900 s. Be aud/leeway (tas pats procesas pasirašo ir tikrina) — dokumentuota.
- **Login be tenant'o:** `findByEmailAllTenants(lower(email))` → verify prieš VISUS kandidatus (be short-circuit); 0 kandidatų → dummy-verify prieš precomputed hash (timing išlyginimas); 1 verifikuojasi → login; ≥2 → **409** `ambiguous-identity` (founder patvirtino; E03-5 host-based ištrins šią šaką).
- **Lockout:** Redis `auth:fail:{ip}:{sha256hex16(email)}`; check PRIEŠ argon2 darbą (CPU cap); ≥5 → 429 + Retry-After; INCR+EXPIRE(15 min nuo pirmo fail); sėkmė → DEL. IP: socket addr, XFF tik su `TRUST_PROXY=1`. Testuojama per injected `{maxFails, windowS}`.
- **Rolių matrica sąžiningai:** realių role-restricted endpoint'ų dar nėra (ateis E03-2/E03-4). Matrica: 4 rolės × {`GET /v1/auth/me` (naujas, realus — web'ui po reload), `/v1/ws-ticket`, `/v1/devices/last`} = 200 eilutės; 403 eilutėms — test-local probe sub-app iš PRODUKCINIO `requireRole` (aiškiai komentuota; E03-2 praplės realiais route'ais). Jokio fake produkcinio endpoint'o.
- **WsAuthContext:** +`role` (ticket'ai gyvena 30 s — jokio suderinamumo lango; E08-2 commands prireiks). ws.ts fanout filtras nekeičiamas.

## Failai

**Nauji:**
- `packages/shared/src/roles.ts` — ROLES/Role/roleSchema (testas: sutampa su Prisma enum) · `packages/shared/src/auth.ts` — `ARGON2ID_PARAMS` (vienas šaltinis: api + seed) + login/refresh req/resp zod schemos.
- `packages/db/src/auth.ts` — `createAuthDb(url)` → `{users:{findByEmailAllTenants, findByIdForAuth}, refreshTokens:{create, claimForRotation, findByTokenHash, revokeFamily}, $disconnect}` — pirmasis PrismaClient repo'e, dokumentuotas kaip E03-2 repo sluoksnio sėkla; **`UNSCOPED_AUTH_METHODS` eksportas** — mašininis allowlist E03-2 izoliacijos meta-testui (garsūs vardai: `findByEmailAllTenants`, ne `findByEmail`).
- `packages/db/prisma/migrations/<ts>_refresh_tokens/` + schema modelis · `packages/db/seed/users.ts` (`pnpm db:seed:user -- --email --password --role --tenant-name [--account-name]`; idempotentiškas; stdout JSON {tenantId,userId} — naudoja Playwright).
- `apps/api/src/auth/passwords.ts` (argon2id hash/verify + dummy hash; vienintelis priedas prie story failų sąrašo) · `auth/jwt.ts` (mint/verify + zod claim shape) · `auth/middleware.ts` (`authMiddleware`, `requireRole`, `problem()` RFC7807 helper, AuthEnv tipai) · `auth/login.ts` (`createAuthRoutes`: POST login/refresh/logout + GET me; lockout; rotacija).
- `apps/api/__tests__/auth.spec.ts` + `__tests__/helpers/auth.ts` (mintAccessToken + fakeAuthDb — ws/devicesLast spec'ai lieka redis-only).
- `docs/adr/019-auth-runtime-deps.md`.

**Keičiami:** `apps/api/src/app.ts` (**AuthStub IŠTRINAMAS**; `ApiDeps` = WsDeps + db + jwtSecret + ttls + lockout + secureCookies; mount tvarka: healthz/metrics → /v1/auth routes → `app.use('/v1/*', authMiddleware)` → ws-ticket/devices-last skaito `c.get('auth')`) · `ws.ts` (+role) · `main.ts` (JWT_SECRET/DATABASE_URL fail-fast; STUB_* išimta; secureCookies default true ne-dev) · `index.ts` · `apps/web/src/lib/auth.ts` (perrašomas: in-memory access token, `login/logout/refreshSession` su single-flight) · `api.ts` (401 → refresh once → retry → logout) · `router.tsx` (async guard: bandyti refresh prieš redirect — sesija išgyvena reload per cookie) · `login.tsx` (email+password; 401/429/409 žinutės; i18n × 4 kalbos) · `tests/pw/{stack,global-setup,smoke}.ts` (seed e2e userį, tenantId → simulator `--tenant`; STUB_AUTH_TOKEN išimtas; + reload-keeps-session testas) · README env lentelė (`JWT_SECRET, JWT_TTL, REFRESH_TTL, LOCKOUT_MAX_FAILS, LOCKOUT_WINDOW_S, TRUST_PROXY`) · package.json'ai.

## Testai

- **auth.spec.ts** (pg+redis testcontainers, prisma deploy pattern iš packages/db): AC[1] rotacija+reuse+lygiagretumo lenktynės ({200,401} ir family mirus); AC[2] matrica; AC[3] PHC regex `\$argon2id\$v=19\$m=65536,t=3,p=4\$`; login happy (Set-Cookie atributai, claim'ai, exp-iat=900); sad paths (401/400/RFC7807); cross-tenant email (skirtingi pw → savo tenant'ai; tas pats pw → 409); timing-equalization (spy: unknown email vis tiek 1× verify); lockout (5 fail → 429 net su teisingu pw; sėkmė resetina; unlock po windowS); logout (cookie cleared, tokenas nebegalioja).
- ws.spec/devicesLast.spec migracija į mintAccessToken+fakeAuthDb.
- Web unit: single-flight (2 lygiagretūs 401 → 1 refresh call), retry-once bounded, fail → session cleared.
- e2e smoke: email+password login, wrong-password klaida, reload išlaiko sesiją.

## Žingsnių tvarka

1. Planas → docs/epics/E03-1-plan.md; branch `feat/e03-1-auth-rbac`.
2. shared (roles+auth schemos) → db (modelis+migracija+authDb+seed) → api auth moduliai → app/ws/main rewire (stub ištrintas) → api testų migracija + auth.spec → web (auth/api/login/router+i18n+unit) → e2e rewire → docs (ADR-019, README).
3. Gates → **adversarinė peržiūra šviežiu subagentu** (fokusas: rotacijos race'ai, lockout apėjimai, timing, cookie atributai, claim'ų validacija) → radiniai → PR → CI → merge → atmintis + W1/W3 status.

## Verifikacija (DoD)

- Pilni gates žali; e2e 5/5 lokaliai ir CI.
- `git grep AuthStub STUB_AUTH_TOKEN` → 0 rezultatų (stub'as pilnai išrautas).
- Manual: dev stack'e `pnpm db:seed:user` → login UI → žemėlapis; reload → sesija gyva; logout → /login; 5× blogas pw → 429 žinutė.
- §10 failure map PR'e: #7 (unscoped auth metodai — fenced allowlist), #10 (jokio JWT URL'e — ticket pattern išlieka), lockout = §6.1 kontrolė.

## Rizikos

- Multi-tab refresh lenktynės → family revoke (AC[1] semantika; single-flight mažina; V2 grace-window dokumentuotas ADR'e).
- `updateManyAndReturn` Prisma 6.19 — jei kliūtis, fallback `$transaction SELECT FOR UPDATE` izoliuotas `claimForRotation` viduje.
- auth.spec'ui reikia Docker pg — lėtesnis, bet izoliuotas viename faile.
- Secure cookie env: main.ts default'ina secure=true, nebent explicit dev — prod misconfig neišjungs Secure.
