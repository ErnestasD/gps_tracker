# E04-1 Plan — Trip state machine (W4 S1)

> Core IP (trip engine) → TEST-FIRST (CLAUDE.md rule 2). Autonominė sesija (founder: „pradek iskarto kita dali"). Playbook: planas → fixtures+failing tests → engine → repo/writer → worker wiring → gates → adversarinė peržiūra → PR → CI → merge → atmintis.

## Context

`apps/worker/src/motion.ts` jau turi `TripDistanceStub` (aiškiai pažymėtą „E04-1 replaces"). Feed'as ateina per I5 seam (`motionRecords` — invalid fixes JAU išfiltruoti, §6.4/I5). `NormalizedRecord` turi viską: `ignition`/`movement`/`speed`/`odometerM`/`fixValid`/`fixTime`/`lat`/`lon`. `Trip` modelis egzistuoja (status enum `open|closed`, distanceM, distanceSource, maxSpeed, idleS, start/end lat/lon/time). Worker naudoja `createPool` (raw pg), NE prisma. Device→tenant/account: Redis `device:tenant` + `device:account` hash'ai (E03-3). presenceRules defaults (seed): `{moveSpeedKmh:6, movingSustainS:90, parkedIgnitionOffS:180, idleSustainS:120}`; asset: `{noIgnition:true, moveSpeedKmh:3, movingSustainS:300, parkedDisplaceM:100}`.

**AC (§8 W4 S1):** trip state machine + unit tests iš fixtures. (Realių įrenginių fixtures laukia geležies E01-6/E02-8 — kol kas simuliuoti/rankiniai position sekų fixtures; realaus vairavimo ±5% validacija = W4 exit, po geležies.)

## Sprendimai

- **Gryna state machine** (`apps/worker/src/trip/engine.ts`): `TripEngine.feed(records, thresholdsFor): TripEvent[]` — PURE, deterministinė (varoma `fixTime`, ne wall-clock → replayable). Per-device state Map (bounded by device count). Emituoja `{type:'open',...}` / `{type:'close',...}` eventus; worker juos verčia į DB. Jokio DB/Redis engine viduje → unit-testuojama be container'ių.
- **Perėjimai (§6.4)**:
  - PARKED→MOVING: `ign==1 && (movement || speed>moveSpeedKmh)` (noIgnition: `speed>moveSpeedKmh`) sustained ≥`movingSustainS` **arba** kaupiamas displacement ≥`movingDisplaceM` (default 300). Trip atidaromas RETROAKTYVIAI nuo kandidato pradžios.
  - MOVING→PARKED: ign-profilis: `ign==0` sustained ≥`parkedIgnitionOffS`; noIgnition: `speed<moveSpeedKmh && stepDisp<parkedDisplaceM` sustained ≥`parkedStopS` (default 300). Uždaroma ties stop-kandidato pradžia.
  - Idle: `ign==1 && speed<idleSpeedKmh` (default 3) sustained ≥`idleSustainS` → kaupiama `idleS`.
- **Distance (§6.4 preference)**: kaupti haversine visada; jei odometras present VISUOSE įrašuose ir monotoniškas → `distanceM = odoEnd-odoStart`, `distanceSource='odometer'`; kitaip haversine, `'gps'`. Odometras trūksta/ne-monotoniškas bet kur → visas trip'as krenta į gps.
- **maxSpeed** = max(speed) per trip.
- **Thresholds**: `TripThresholds` injectable, default = standard profile. E04-1 worker paduoda DEFAULTS visiems (per-device profile presence_rules → **E04-5** „per-device config"). noIgnition logika PILNAI implementuota+testuota, tik per-device selection deferred. Pažymėti `// TODO(E04-5)`.
- **Persistence** (`packages/db/src/tripWriter.ts`, raw SQL per pool — kaip `writer.ts` positions'ams, laiko DB SQL packages/db viduje, rule 2): `openTrip(pool, {...}) → bigint id`, `closeTrip(pool, id, {...})`. Worker'is laiko `Map<deviceId, openTripId>`; open→insert(status='open'), close→update(status='closed'). Tenant/account iš Redis hash'ų.
- **Worker wiring**: `MotionFeed.tripDistance` (stub) → `TripEngine`; `onBatch` po `motionFeed.feed` verčia eventus per tripWriter. Tenant/account resolve iš `device:tenant`/`device:account` (kaip liveState). Registry miss → skip persist (log), engine state vis tiek progresuoja.

## Failai

**Nauji:** `apps/worker/src/trip/engine.ts` (state machine + TripThresholds + DEFAULT_THRESHOLDS + TripEvent); `apps/worker/__tests__/trip-engine.spec.ts` (fixtures + assertions); `packages/db/src/tripWriter.ts` (openTrip/closeTrip raw SQL); docs/epics/E04-1-plan.md.

**Keičiami:** `apps/worker/src/motion.ts` (MotionFeed naudoja TripEngine vietoj TripDistanceStub; stub'ą palikti eksportuotą jei kiti testai remiasi — patikrinti; kitaip pašalinti); `apps/worker/src/main.ts` (resolve tenant/account + persist trip events per pool); `packages/db/src/index.ts` (+tripWriter export).

## Testai (test-first — pavadinti fixtures)

- **trip-basic**: park → drive (opens po ≥movingSustainS) → ign off ≥parkedIgnitionOffS (closes) ⇒ 1 trip, teisinga trukmė + haversine distance + start/end taškai.
- **trip-open-by-displacement**: greitas ≥300m poslinkis <90s ⇒ atsidaro pagal displacement.
- **trip-idle**: drive → idle (ign=1 speed<3 ≥120s) → drive → stop ⇒ 1 trip, idleS ≈ idle trukmė.
- **trip-odometer**: monotoniškas odometras ⇒ distanceSource='odometer', distance = Δodo (ne haversine).
- **trip-odometer-broken**: odometras dingsta viduryje ⇒ fallback 'gps' haversine.
- **trip-no-ignition**: noIgnition thresholds, speed/displacement stop ⇒ trip be ignition signalų.
- **trip-noise**: trumpas judesys <movingSustainS ir <movingDisplaceM ⇒ JOKIO trip (kandidatas reset).
- **trip-invalid-fix-filtered**: engine feed praeina pro motionRecords (invalid fix niekada nepasiekia) — I5 dvigubas sargas.
- **worker wiring** (jei įmanoma be container): tripWriter open/close per pg testcontainer → trips eilutė teisinga.

## Žingsniai

1. Branch `feat/e04-1-trip-engine`. Planas → docs/epics. ✅
2. engine.ts tipai + DEFAULT_THRESHOLDS → fixtures+failing tests → implementacija iki žalia.
3. tripWriter.ts (pg testcontainer testas open/close).
4. Worker wiring (motion.ts + main.ts) → typecheck/lint.
5. Pilni gates → adversarinė peržiūra (fokusas: I5 invalid-fix niekada nekeičia distance; cross-batch fixTime disorder — E04-2 recompute, bet engine neturi krašuoti; odometer monotonic guard prieš rollover/reset; idle nedvigubinamas; unbounded device-state Map; tenant leak — trip tenant/account iš registry, ne guess; open trip be close crash → E04-2; distance non-negative) → radiniai → PR → CI → merge → atmintis.

## Verifikacija (DoD)

- Gates žali; trip-engine.spec fixtures įrodo perėjimus + distance preference + idle + I5.
- Manual: simulator liveDrive per worker → trips eilutė atsiranda (open→closed).
- §10: I5 (invalid fix niekada nekeičia trip distance) — motionRecords + engine testas.

## Rizikos

- **Realių fixtures nėra** (geležis laukia): E04-1 logika ant simuliuotų/rankinių sekų; ±5% realaus vairavimo validacija = W4 exit po E01-6/E02-8. Pažymėti plane.
- **Per-device thresholds**: E04-1 = defaults; per-profile presence_rules = E04-5. Asset trackeriai (noIgnition) negamins trip'ų su default ign-thresholds iki E04-5 — dokumentuota.
- **Cross-batch fixTime disorder**: engine varomas fixTime, bet feed'as gali gauti senesnį batch'ą vėliau (consumer.ts note). E04-1 daro prielaidą tvarkingo feed; late-batch recompute = E04-2. Engine neturi krašuoti/produkuoti neigiamų distancijų esant disorder (guard: ignoruoti įrašą su fixTime < lastTime open trip'e arba clamp).
- **Odometer rollover/reset**: monotonic guard (Δ<0 → ne-monotoniškas → gps fallback).
- **Crash su open trip**: in-memory state prarandamas; open trip eilutė lieka DB. E04-2 recompute uždaro/perskaičiuoja. E04-1 pažymi.
