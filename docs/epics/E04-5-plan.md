# E04-5 Plan — Odometer preference + per-device config (W4 S5)

> Paskutinė W4 story. Autonominė sesija. §6.4: „prefer Δodometer_m when device odometer present & monotonic, else haversine. Thresholds in device_profiles.presence_rules." Playbook: planas → engine refactor (test-first) → registry sync + resolver → UI → gates → peržiūra → PR → CI → merge → atmintis.

**AC (§8 W4 S5):** odometer preference logic + per-device config.

## Context

E04-1 trip engine naudoja DEFAULT_THRESHOLDS VISIEMS device'ams (`new TripEngine(thresholds)`), ir odometras = monotonic-preference ('auto'). Device modelis JAU turi `odometerSource` (auto/device/gps) + `profileId`→`profile.presenceRules` jsonb. Registry sync (activateDevice) sinchronizuoja tik device:tenant/account. Trūksta: per-device thresholds (asset/noIgnition) + odometerSource override.

## Sprendimai

- **Engine per-device config** (gryna, test-first): `DeviceTripConfig = { thresholds: TripThresholds; odometerSource: 'auto'|'device'|'gps' }`. `feed(records, configFor?: (deviceId)=>DeviceTripConfig|undefined)`. Engine cache'ina config per device DeviceState'e (resolvina VIENĄ kartą state kūrime → stabilu per trip). step() naudoja `st.config.thresholds` vietoj `this.thresholds`. Konstruktoriaus thresholds lieka kaip fallback default.
- **Odometer preference** (close()): track haversine + odoStart/odoLast + odoBrokenStrict (bet koks Δ<0). Sprendimas pagal odometerSource:
  - `gps` → visada haversine ('gps').
  - `device` → odometras jei present (odoStart&odoLast != null) IR Δodo≥0, kitaip gps (tolerantiškas tarpiniam non-monotonic).
  - `auto` → odometras jei present IR monotonic VISUR (!odoBrokenStrict) IR Δ≥0, kitaip gps (griežtas, = E04-1 elgesys).
- **presence_rules → TripThresholds** mapper (`thresholdsFromRules(rules): TripThresholds`): merge su DEFAULT_THRESHOLDS (užpildo trūkstamus movingDisplaceM/idleSpeedKmh/parkedStopS). noIgnition iš rules.
- **Registry sync**: `activateDevice` papildomai `hset device:config {id} JSON({presenceRules, odometerSource})`. RegistryDevice + presenceRules + odometerSource. Callers (device create, quarantine claim) resolvina profile.presenceRules (db.profiles.get) + device.odometerSource. deactivate → `hdel device:config`.
- **Worker resolver**: prieš feed, worker resolvina config unique deviceId batch'e iš Redis (`device:config` hget, cache Map su TTL/refresh), build configFor. Miss → undefined (engine → default). Cache bounded (LRU/refresh per-batch OK; device count bounded).
- **UI**: device create forma + `odometerSource` select (auto/device/gps). Inline edit per device row (PATCH odometerSource) — mažas. i18n×4.

## Failai

**Nauji:** `apps/worker/src/trip/config.ts` (DeviceTripConfig + thresholdsFromRules); `apps/worker/__tests__/` papildyti engine per-device testus; docs/epics/E04-5-plan.md.

**Keičiami:** `apps/worker/src/trip/engine.ts` (feed configFor + per-device thresholds + odometerSource close logic); `apps/worker/src/trip/persister.ts` arba main.ts (resolve device:config → configFor); `apps/api/src/routes/deviceRegistry.ts` (activateDevice device:config); `apps/api/src/routes/crud.ts` + quarantine (pass presenceRules+odometerSource į activate — resolve profile); `apps/web/src/{routes/app/devices/index.tsx (odometerSource select + edit), lib/devices.ts, i18n×4}`; README.

## Testai (test-first engine)

- **per-device thresholds**: configFor grąžina asset (noIgnition) config vienam device, default kitam → asset device atidaro trip pagal speed (be ignition), default reikalauja ignition. Interleaved batch.
- **odometerSource gps**: monotonic odometras BET source='gps' → distanceSource='gps' (haversine), ignoruoja odo.
- **odometerSource device**: odometras su tarpiniu non-monotonic bet Δ≥0 → 'odometer' (device tolerantiškas), o 'auto' tam pačiam → 'gps'.
- **thresholdsFromRules**: merge default + rules override; noIgnition.
- **config cache/resolver** (worker): device:config hget → configFor (fake redis).
- **registry sync**: activateDevice rašo device:config; deactivate trina (unit su fake redis).
- Esami engine testai LIEKA žali (feed be configFor → constructor default).

## Žingsniai

1. Branch + planas. ✅
2. config.ts + engine refactor → esami+nauji engine testai žali.
3. registry device:config + callers → api testai.
4. worker resolver (config cache) + wiring → typecheck.
5. UI odometerSource + i18n → web gates + e2e (device create su odometerSource).
6. README → pilni gates → adversarinė peržiūra (fokusas: per-device config nemaišo state tarp device'ų; odometerSource negali duoti neigiamo/klaidingo distance; asset device tenant scope; config cache stale po profile keitimo — refresh; presence_rules mapper defaults; registry sync konsistencija su tenant/account) → PR → CI → merge → atmintis (W4 DONE).

## Rizikos

- **Config stale**: profile presence_rules keitimas po activate → device:config sena iki re-activate. V1: config refresh per-batch iš Redis (device CRUD re-syncs). Dokumentuoti; profile edit → re-sync (V2 arba activate on profile change).
- **odometerSource 'device' su blogu odo**: Δ<0 → fallback gps (guard).
- **State per-device izoliacija**: config cache'inamas DeviceState'e, ne globaliai — nemaišo.
- **Asset noIgnition be per-device iki E04-5**: dabar sutvarkoma.

## Verifikacija (DoD)

- Gates + engine testai (per-device thresholds + odometerSource) žali; registry sync; UI odometerSource.
- Manual: asset profile device → trip be ignition; odometerSource=gps device → haversine distance.
- W4 EXIT: real-drive ±5% (po geležies E01-6/E02-8) — dokumentuota, ne šioje story.
