# E04-4 Plan — Trips list + detail (route, stats) (W4 S4)

> Autonominė sesija. Daugiausia WEB — trips API jau yra (E04-3: GET /v1/trips, /v1/devices/:id/trips, /v1/trips/:id; positions reader). Playbook: planas → lib → Trips list + detail → nav/i18n → gates → peržiūra → PR → CI → merge → atmintis.

**AC (§8 W4 S4):** trips list + detail (route, stats).

## Sprendimai

- **lib/trips.ts**: `listTrips({deviceId?, from?, to?, limit?})` → GET /v1/trips (jau backend). `getTrip(id)` → GET /v1/trips/:id. TripView tipas iš shared. Trukmės/greičio helper'iai (gryni, testuojami): `tripDurationMs(t)`, `fmtDuration(ms)`, `fmtKm(m)`.
- **Trips list puslapis** (`routes/app/trips.tsx`, nav Fleet→Trips): filtrai (device select — reuse listDevices; data nuo/iki). Lentelė: įrenginys, pradžia, trukmė, atstumas (km + source badge), maxSpeed, idle, status. Eilutės click → detalės.
- **Trip detalė** (šoninė panelė arba route param `?trip=<id>`): pasirinkto trip'o maršrutas žemėlapyje — reuse `PlaybackMap` su positions to trip'o lange (`listPositions(deviceId, {from:startTime, to:endTime})`), + stats kortelė (distance/source, trukmė, maxSpeed, idle, start/end laikas). Stop markers (trip start/end) jau PlaybackMap.
- **i18n×4** (trips.* namespace), nav (`shell.trips` placeholder → /app/trips), web unit test (fmtDuration/fmtKm + query builder), e2e (login → Trips → matomas sąrašas iš e2e drive trip'ų → click → detalė su maršrutu).
- Backend: NIEKO naujo (trips API + positions iš E04-3). Jei reikia — GET /v1/trips jau grąžina scoped su deviceId/from/to filtrais.

## Failai

**Nauji:** `apps/web/src/{lib/trips.ts, routes/app/trips.tsx}`; `apps/web/__tests__/trips.spec.ts`; docs/epics/E04-4-plan.md.

**Keičiami:** `apps/web/src/{router.tsx (+trips route), components/AppShell.tsx (shell.trips → /app/trips), i18n×4}`; `apps/web/tests/pw/smoke.spec.ts` (trips e2e); README.

## Testai

- **web unit**: tripDurationMs/fmtDuration (0, sekundės, minutės, valandos), fmtKm, trips query builder (reuse historyQuery ar naujas).
- **e2e**: login → drive device (positions+trip) → /app/trips → trip eilutė matoma su distance/trukme → click → detalė žemėlapyje (maršrutas + stats). Robustiškas su .or (jei trip nesusidaro window — bent tuščias sąrašas).
- Isolation/api: trips scope jau padengta E04-3 (nieko naujo).

## Žingsniai

1. Branch + planas. ✅
2. lib/trips.ts (listTrips/getTrip + duration/format helpers) → gates + unit test.
3. Trips list puslapis + detalė (reuse PlaybackMap) → gates.
4. nav + i18n + router → gates + e2e.
5. README → pilni gates → adversarinė peržiūra (fokusas: trip scope (jau E04-3 gate); detail positions per device scope; duration/format edge (endTime null open trip); XSS n/a; unbounded list — limit) → PR → CI → merge → atmintis.

## Rizikos

- **Open trip detail**: endTime null (dar vyksta) → trukmė = now − start; positions to „now"; žymėti „vyksta".
- **Scope**: trips list per /v1/trips (scoped); detail positions per /v1/devices/:id/positions (device-scope gate E04-3). Jokio naujo leak paviršiaus.
- **Unbounded**: listTrips limit (backend clamp 5000); UI rodo puslapį.

## Verifikacija (DoD)

- Gates + web unit + e2e žali; trips sąrašas + detalė (maršrutas+stats).
- Manual: /app/trips → filtrai → eilutė → detalė su maršrutu.
