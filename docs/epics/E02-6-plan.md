# E02-6 Plan — Web shell: auth, device list, live map, PWA

> Implementacijos pradžioje šis planas nukopijuojamas į `docs/epics/E02-6-plan.md` (playbook §2).
> Founder sprendimai (2026-07-07): **(1)** pridėti stub snapshot endpoint'ą į apps/api; **(2)** darbas skaidomas į **2 PR** (PR-A backend prep, PR-B web).

## Context

W1+W2 pipeline baigtas (PR #2–#11): ingest → worker → live state (Redis `device:{id}:last` + pub/sub `live:{tenant}`) → WS gateway (`/v1/stream?ticket=`, single-use ws-ticket, stub auth `STUB_AUTH_TOKEN`, api :3010). `apps/web` — tuščias stub'as. E02-6 pastato pirmą realų UI: login (stub era) → app shell → live žemėlapis, kuris sklandžiai rodo 500 simuliuotų įrenginių, + PWA. Spec šaltiniai: IMPLEMENTATION_PLAN E02-6, PROJECT_PLAN §5/§6.6, DASHBOARD_UI_SPEC (kanoninis dizainui), CLAUDE.md rule 13 (free stack, OSM atribucija).

**AC:** login → žemėlapis su 500 simuliuotų įrenginių be jank'o · OSM atribucija matoma visur · Lighthouse installable PWA · tiles style keičiamas per env be kodo keitimo · Playwright smoke (login→map→marker iš simuliatoriaus).

## Patikrintas kontraktas (nekeičiamas, prieš kurį koduojam)

- `GET /v1/ws-ticket` + `Authorization: Bearer <STUB_AUTH_TOKEN>` → `{ticket, expiresInS:30}`; 401 RFC7807.
- WS `ws://host:3010/v1/stream?ticket=<t>` — single-use (GETDEL), be welcome msg, **be backfill**.
- WS žinutė = `apps/worker/src/liveState.ts` `compact` objektas: `{deviceId:string, accountId:string|null, fixTimeMs:number, lat, lon, speed|null, course|null, satellites, fixValid, ignition|null, priority}`.
- Redis: `registry:imei` (imei→deviceId), `device:tenant`, `device:account`, `device:{id}:last` → `{fixTimeMs, json}` (json = tas pats compact). Seed skripto nėra — E02-4 testai hset'ina tiesiogiai.
- Stub ctx: tenant-wide (`STUB_TENANT_ID`, default `stub-tenant`), be accountId. CORS api nėra → dev'e Vite proxy.
- Vardų/labels niekur nėra (device CRUD = E03-3) → DeviceList rodo deviceId.

## PR-A — backend prep (simulator fleet + seed + shared schema + snapshot API), ~700 LOC

1. **`packages/shared/src/liveEvents.ts`** (naujas; E02-4 žadėtas, nesukurtas): `liveEventSchema` (zod) + `LiveEvent` tipas, atitinkantis liveState.ts `compact` pažodžiui. Testas `packages/shared/__tests__/liveEvents.spec.ts` — fixture literal drift-tripwire. Worker NEKEIČIAMAS.
2. **Simulator fleet mode** (AC reikalauja 500 įrenginių; dabar 1 device/procesas):
   - `tools/simulator/src/drive.ts`: optional `startDistanceM` (`Route.at()` wrap'ina modulo totalM — saugu). Be jo visi 500 startuotų viename taške (seed keičia tik greitį).
   - `tools/simulator/src/scenarios/types.ts`: `startDistanceM` į `ScenarioOpts`; naudoja tik liveDrive.
   - Naujas `tools/simulator/src/fleet.ts`: `runFleet` — N in-process socket'ų, `imei = base+i`, `seed = seed+i`, `startDistanceM = i*spreadM` (default 60 m), staggered start (`--ramp-ms`, default 20 → pilnas ramp per 10 s). Exit 1 jei bent vienas atmestas.
   - `main.ts` flags: `--devices` (default 1 — esamas kelias nepaliestas), `--ramp-ms`, `--spread-m`.
   - Naujas `tools/simulator/src/seed.ts` + root script `sim:seed`: HSET `registry:imei`, `device:tenant` (default `stub-tenant`) N įrenginių. Flags `--devices --imei --tenant --redis-url`. Dep: `ioredis` į tools/simulator (dev tooling, versija kaip worker'io).
   - Testai: `tools/simulator/__tests__/fleet.spec.ts` (IMEI derivacija, spread, determinizmas).
3. **Snapshot endpoint** (founder patvirtino): `GET /v1/devices/last` apps/api — HGETALL `device:tenant` → filter pagal ctx.tenantId → pipeline HGET `device:{id}:last json` → `{devices: LiveEvent[]}`. Account-scoped ctx filtruojamas per `device:account` **fail-closed** (ta pati semantika kaip ws.ts). Pažymėtas stub-markeriu (kaip AuthStub): E03-3 perkelia į scoped repo per packages/db. Testai `apps/api/__tests__/devicesLast.spec.ts`: tenant izoliacija (t2 įrenginio nėra t1 atsakyme), account fail-closed, 401 be tokeno.
4. Demo komanda (dokumentuojama README): `pnpm sim:seed -- --devices 500 && pnpm sim -- --scenario liveDrive --devices 500 --count 600 --hz 1`.

## PR-B — apps/web + Playwright + CI, ~55 failų / ~3.5–4.5k LOC (~800 vendorintas shadcn)

### Struktūra
```
apps/web/
  package.json                dev/build/preview/typecheck/lint/test/e2e
  tsconfig.json               jsx react-jsx, moduleResolution Bundler, lib DOM; src+__tests__
  tsconfig.node.json          vite.config.ts, playwright.config.ts, tests/pw/**  ← eslint projectService reikalauja
  tsconfig.sw.json            sw.ts (lib WebWorker)
  vite.config.ts              react + @tailwindcss/vite + VitePWA(injectManifest) + /v1 proxy (http+ws) į :3010
  index.html · public/manifest.webmanifest · public/icons/{192,512,maskable}.png
  public/dev-style.json       lokalus background-only MapLibre style — e2e determinizmas + AC[4] env-swap įrodymas
  sw.ts                       ~30 eil.: precacheAndRoute(__WB_MANIFEST); /v1/* ir tiles NIEKADA necache'inami
  playwright.config.ts · tests/pw/{global-setup.ts,smoke.spec.ts}
  src/
    main.tsx · router.tsx     code-based route tree (be codegen — nekovoja su typed eslint)
    routes/__root.tsx · login.tsx · app.tsx (beforeLoad guard → /login) · app/map.tsx
    lib/auth.ts               stub token sessionStorage'e (E03-1 pakeis į httpOnly refresh + in-memory access)
    lib/api.ts                fetch wrapper; base = VITE_API_URL ?? same-origin; Bearer; 401 → logout redirect;
                              getWsTicket(); getLastPositions() → seed store (PR-A snapshot)
    lib/ws.ts                 LiveSocket klasė (framework-free, injected deps): kaskart NAUJAS ticket'as,
                              exp backoff 1s·2^n cap 30s ±20% jitter, reset po open; singleton store'e
                              (ne komponento effect'e — StrictMode double-mount nedegina ticket'ų)
    lib/liveStore.ts          PERF ŠERDIS: Map<deviceId, LiveEvent> max-wins pagal fixTimeMs; dirty set;
                              1 Hz flush (skip kai document.hidden): GeoJSON→map.setData, status perskaičiavimas
                              (online ≤60s / stale ≤10min / offline), useSyncExternalStore su stabiliais ref'ais.
                              WS žinutė tarp flush'ų = tik Map mutacija, zero React darbo.
    components/LiveMap.tsx    MapLibre: style=VITE_TILES_STYLE_URL (vienintelė skaitymo vieta),
                              AttributionControl visada matomas ("© OpenStreetMap contributors"),
                              GeoJSON source cluster:true; layers: clusters (accent), cluster-count,
                              devices (SDF arrow runtime-canvas, icon-rotate=course, stale=pilka),
                              selected-halo (accent-2, setFilter), trail LineString. Follow: easeTo 1×/s.
    components/DeviceList.tsx 320px floating panel: search (deviceId), StatusDot+id+speed; BE virtualizacijos
                              (500 memoized eilučių @1 Hz ok; content-visibility:auto; fallback užrašomas PR'e)
    components/InfoCard.tsx   speed, ignition, sats, fixValid, relative time (Intl.RelativeTimeFormat)
    components/AppShell.tsx   sidebar 240→64px collapse + topbar 56px (logo, logout); ne-Live nav punktai disabled
    components/ui-x/StatusDot.tsx (spec §3: dot+label, ne vien spalva)
    components/ui/{button,input,card,badge,skeleton,tooltip}.tsx   vendorintas shadcn — MINIMALUS setas
    i18n/{index.ts,en,pl,lt,de}.json   i18next+react-i18next+languagedetector; visi stringai per t()
    styles/tokens.css         DASHBOARD_UI_SPEC §1 pažodžiui; dark = :root default, .light overrides
    styles/index.css          Tailwind v4 @theme inline mapping + shadcn semantiniai aliasai
```
- `src/index.ts`+`index.spec.ts` ištrinami tame pačiame commit'e, kuriame atsiranda pirmi tikri testai (hook gate visada žalias).
- **Tailwind v4** (CSS-first `@theme`, be tailwind.config.js; shadcn palaiko) — šviežias repo, be legacy.
- **PWA:** vite-plugin-pwa **injectManifest** su mūsų `sw.ts` (story failų sąrašas literalus) + statinis manifest.webmanifest; start_url `/app/map`, standalone, ikonos 192/512/maskable. Lighthouse — manual check, dokumentuotas README.
- **Trail:** minimalus session-buffer (tik pasirinktam įrenginiui, ring buffer 3600 tšk., LineString). Dashed invalid-fix gap — E02-7 (fixValid jau saugomas kiekviename taške). „Last 1 h" backfill neįmanomas be E04-3 istorijos API — sąžiningai pažymima PR'e.
- **Startas:** load → `getLastPositions()` seed'ina store → WS connect; max-wins išsprendžia lenktynes.

### Deps → docs/adr/018-web-runtime-deps.md (rule 10)
Runtime: react, react-dom, @tanstack/react-router, @tanstack/react-query, maplibre-gl, i18next, react-i18next, i18next-browser-languagedetector, @fontsource-variable/inter, lucide-react, cva/clsx/tailwind-merge, @radix-ui/react-slot, @radix-ui/react-tooltip, @orbetra/shared. Visi — užrakinto stack'o (§5 / DASHBOARD_UI_SPEC) dalys.
Dev: vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, vite-plugin-pwa, workbox-precaching, @types/react(-dom), @playwright/test, testcontainers, ioredis (simulator seed).
NĖRA: Recharts, TanStack Table, terra-draw, virtualizacija — ne šios story.

### Testai
- Vitest (gates, greiti, node-env): `apps/web/__tests__/ws.spec.ts` (fake timers: naujas ticket per attempt, backoff/jitter/reset/stop), `liveStore.spec.ts` (max-wins, batching, status ribos, stable refs); PR-A testai aukščiau.
- **Playwright smoke** `tests/pw/smoke.spec.ts` (atskiras `e2e` task — NE vitest'e, hook gate lieka sekundinis): global-setup pastato VISĄ stack'ą (testcontainers redis+pg → migracijos → ingest:5127/worker/api:3110 child-procesai su `STUB_AUTH_TOKEN=e2e-token` → seed 3 devices → `vite build` su `VITE_TILES_STYLE_URL=/dev-style.json` → `vite preview :4173`). Testas: login blogu tokenu → klaida; geru → `/app/map` + atribucija matoma (AC[2]) → paleidžiam sim `--devices 3` → **DOM assert** DeviceList eilutei (ne canvas pixel — CI WebGL neflake'ina). Chromium `--enable-unsafe-swiftshader`. Biudžetas <2.5 min.
- CI: naujas `web-e2e` job ci.yml (lygiagretus `gates`; Docker runner'yje jau naudojamas testcontainers'ų; playwright browser cache pagal versiją).

### Kiti pakeitimai
- turbo.json: `dev` task (`cache:false, persistent:true`) — CLAUDE.md jį jau žada.
- README env lentelė: `VITE_API_URL`, `VITE_TILES_STYLE_URL` + manual-check procedūros (Lighthouse, MapTiler swap, 500-device demo komanda).

## Žingsnių tvarka (kiekvienas palieka gates žalius)

1. Planas → `docs/epics/E02-6-plan.md`; branch `feat/e02-6a-fleet-shared-snapshot`.
2. PR-A: shared liveEvents → simulator fleet+seed → api snapshot + testai → gates → **adversarinė peržiūra (šviežias subagentas)** → PR → CI → merge.
3. Branch `feat/e02-6b-web-shell`. Scaffold vienu commit'u (package.json, 3 tsconfig, vite.config, index.html, styles, i18n, main/router/tušti routes; index.ts→liveStore swap).
4. lib/{auth,api,ws} + unit testai → shadcn ui + tokens + AppShell + StatusDot + login+guard → LiveMap+DeviceList+InfoCard+follow+trail.
5. Manual AC[1]: `make up` + api/worker/ingest + seed + fleet 500 — sklandumo patikra.
6. PWA (manifest, sw.ts, ikonos) + manual Lighthouse.
7. Playwright harness + smoke + ci.yml `web-e2e`.
8. Docs (README, ADR-018) → gates → adversarinė peržiūra → radinių taisymas → PR-B → CI → merge.

## Verifikacija (DoD)

- `pnpm turbo run typecheck lint test --filter=...@orbetra/web` (+ simulator, shared, api filtrams) žalia.
- Playwright smoke žalias lokaliai ir CI.
- Manual: 500-device demo be jank'o (AC[1]); Lighthouse installable (AC[3]); `VITE_TILES_STYLE_URL` swap → be kodo keitimo (AC[4], dokumentuota); OSM atribucija ant visų map view (AC[2]).
- Izoliacijos aspektas: devicesLast testai įrodo tenant filter + account fail-closed (ws.ts semantikos paritetas).
- §10 failure map PR'e: unbounded buffers (trail ring cap, liveStore Map — bounded seed'intų įrenginių aibe), timezone (tik relative time live kontekste, Intl), invalid-fix (nekeičia trail'o iki E02-7 — tik presence/status).

## Rizikos

- **StrictMode × single-use ticket** → LiveSocket singleton store'e, connect idempotent.
- **CI headless WebGL** → swiftshader + DOM assertai + lokalus style JSON.
- **500 socket'ų vs ingest per-IP cap (200!)** → demo paleidime `INGEST_MAX_CONN_PER_IP=1000` env (be kodo keitimo); užrašoma README demo sekcijoje.
- **eslint projectService** → visi tsconfig'ai land'ina kartu su failais, kuriuos dengia.
- **Snapshot HGETALL platform-wide** → stub era ok (≤500), E03-3 perkelia į DB repo; stub-markeris kode.

## Ne šios story (neliesti)

⌘K palette, notifications, tenant switcher, EntityDrawer/DataTable/toasts, address search (Photon dar neintegruotas), history/trips/geofences, light-mode UI toggle, device vardai/grupės, Recharts, Storybook, i18n lint rule (E08-3).
