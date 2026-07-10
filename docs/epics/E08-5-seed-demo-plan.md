# E08-5 Plan — tools/seed-demo (demo tenant sales skambučiams)

> W8 S4 dalis: „`tools/seed-demo` (demo tenant with realistic fleet for sales calls)". Paskutinis V1-MUST software gap. Autonominė sesija.

## Tikslas

Viena komanda (`pnpm seed:demo`) prieš VEIKIANTĮ stack'ą (local dev arba staging) sukuria pilną, realistiškai atrodantį demo tenant'ą, kuriuo founderis gali rodyti visą produktą: gyvą žemėlapį, istoriją/playback su kuro grafiku, trips, events, geofences, rules, komandas, reports.

## Dizainas

- **tools/seed-demo** workspace paketas (dev-tool, ne runtime dep — kaip simulator/replay). Env: `DATABASE_URL`, `REDIS_URL`, `INGEST_HOST`/`INGEST_PORT` (default 127.0.0.1:5027), `DEMO_PASSWORD` (default sugeneruojamas ir ATSPAUSDINAMAS).
- **Provisioning per esamus sluoksnius (jokio dublikavimo):** `@orbetra/db` createDb repos (tenant/accounts/users/devices/geofence/rules) + `@orbetra/api` `activateDevice` (registry sync — tas pats kodas kaip CRUD; isolation jau importuoja @orbetra/api precedentas) + `@orbetra/simulator` `runScenario`/`driveRecords` (istorija per TIKRĄ pipeline: ingest → worker → positions/trips/events — ne DB insert'ai, todėl viskas suderinta su realiu elgesiu).
- **Turinys:** tenant „Demo Logistics" (branding: pavadinimas + spalva); 2 accounts („Vilnius Fleet", „Kaunas Fleet"); users: demo-admin@ (tsp_admin), demo-manager@ (account_manager A1), demo-viewer@ (viewer A1); 12 devices (LT vardai/valstybiniai nr., fmb1xx, IMEI blokas 8670001200000xx Luhn-ok? — IMEI validacija: 15 skaitmenų regex, Luhn tik import'e); geofence „Vilnius Depot" + overspeed(90) ir panic rules; istorija: kiekvienam device 2 važiavimai/dieną × 3 dienos (startMs atgal, skirtingi seed/offset — skirtingi greičiai/pozicijos), 1 device panic scenarijus (event'as), 1 su invalidFix ruožu (dashed gap demo). Fuel: liveDrive jau siunčia AVL 89.
- **Idempotencija:** device create pagal unikalų IMEI — jei jau yra, praleidžiam (re-run saugus); tenant/account/user lookup-or-create pagal pavadinimą/email.
- **Įspėjimas:** skirtas dev/staging — atsisako veikti jei `NODE_ENV=production` be `--force`.

## Failai

**Nauji:** tools/seed-demo/{package.json,tsconfig.json,src/main.ts,src/plan.ts (pure fleet/drive planas),__tests__/plan.spec.ts,__tests__/seed-demo.spec.ts (integration: testcontainers pg+redis + in-process ingest server — devices sukurti, positions atsirado per pipeline)}; docs/epics/E08-5-seed-demo-plan.md.
**Keičiami:** root package.json (script `seed:demo`), turbo.json (jei reikia), README (Demo data sekcija).

## Testai

- **plan.spec (pure):** determinis planas iš seed: 12 devices, drive'ų startMs praeityje ir didėjantys, imei unikalūs 15-skaitmeniai, panic/invalid priskirti teisingiems device.
- **seed-demo.spec (integration):** pg+redis containeriai + prisma migrate + in-process ingest (kaip apps/ingest testai) → run seed → asserts: tenant/accounts/users/devices DB'e; registry:imei sync'intas; ingest ACK'ino > 0 records; re-run neduplikuoja devices. (Worker pipeline necontainer'inam — positions į raw stream patenka, to pakanka įrodyti transport'ą; pilnas positions kelias jau įrodytas e2e.)

## Verifikacija (DoD)

Gates žali; integration testas žalias; README dokumentuota kaip paleisti prieš local/staging; rule 12 — jokių tikrų IMEI (867xxx sintetinis blokas kaip simulator); jokių naujų runtime deps (visi workspace vidiniai).

## Rizikos

- **Worker būtinas realiam demo** (positions/trips atsiranda tik jam veikiant) — README pažymi „paleisk pilną stack'ą (make up + apps) prieš seed'ą".
- Staging paleidimas — tas pats skriptas su staging env kintamaisiais per SSH (dokumentuota; nevykdoma šiame story).

## Peržiūros pataisos (2 HIGH + 4 MED + 6 LOW — visos pritaikytos)

- **H1 worker nieko nematytų:** rules/geofences dabar sync'inami į Redis per api `syncRule`/`syncGeofence` (naujai eksportuoti — ta pati implementacija kaip CRUD; integracinis testas asserts hash'us `rule:tenant:{id}`/`geofence:tenant:{id}`).
- **H2 amžinai atviri trips:** simulator `parkTailS` — kiekvienas važiavimas baigiasi stacionaria ignition-OFF uodega (240 s > parkedIgnitionOffS 180) → trip'ai UŽSIDARO; panic/invalidFix scenarijai dabar perduoda startDistanceM+parkTailS (L5).
- **M1 production guard:** POZITYVUS opt-in — ne-loopback DB/ingest taikinys reikalauja SEED_DEMO_ALLOW=1/--yes (unset NODE_ENV prod boxe nebepraslysta); NODE_ENV=production papildomai --force.
- **M2 slaptažodis:** re-run per-štampuoja demo userių hash'ą — atspausdintas slaptažodis VISADA veikia.
- **M3 istorijos dublikatai:** istorija siunčiama tik kai devices ką tik sukurti (arba --with-history); testas asserts stream depth nepakitęs.
- **M4 cross-tenant IMEI clash:** DuplicateImeiError gaudomas su actionable žinute, run'as resumable (imeiConflicts skaitiklis).
- **L:** profile presenceRules perduodami į device:config (ne hardcode); realpath entrypoint guard; overspeed riba 60 (drives 30–70 → events realiai fire'ina); INGEST_PORT validacija; 'BXA' literal. L2 (seedProfiles deep import) paliktas su pastaba — eksportas iš @orbetra/db liečia db paketo public surface, follow-up.
