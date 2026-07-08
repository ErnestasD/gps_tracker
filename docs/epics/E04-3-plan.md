# E04-3 Plan — History API + playback UI (W4 S3)

> Autonominė sesija (founder: „tęsiam toliau"). Scout atliktas (project-status atmintis). Playbook: planas → shared tipai → db read layer → api routes+testai → web playback → gates → adversarinė peržiūra → PR → CI → merge → atmintis.

## Context

§6.6: `GET /v1/devices/:id/positions?from&to&cursor` (max 10k/page) + `GET /v1/devices/:id/trips?from&to`. Positions = raw SQL (rule 1, packages/db pool), NE Prisma. Trips = Prisma model (scoped repo). API app dabar NETURI pg.Pool (tik Prisma Db) → reikia prakišti. Web neturi playback puslapio; yra `buildTrailFeatures` (liveStore.ts:56) + MapLibre trail sluoksniai (LiveMap.tsx) reuse. Chart lib NĖRA dep → speed chart hand-rolled SVG (jokio naujo dep/ADR).

**AC (§8 W4 S3):** history API + playback UI (timeline scrub, speed chart, stop markers).

## Sprendimai

- **Shared tipai** (packages/shared/src/entities.ts): `positionSchema`/`Position` (deviceId string, fixTime ISO, lat/lon, speed, course, ignition, fixValid, odometerM string|null), `tripView` tipas (JSON shape: id/deviceId string, times ISO). Query: from/to ISO, cursor, limit. JSON shape = crud.ts toJson (BigInt→string, Date→ISO).
- **Positions reader** (packages/db/src/positions.ts, raw SQL per pool — kaip recompute.ts:90): `readPositions(pool, deviceId: bigint, opts:{from?,to?,cursor?,limit?}): Promise<PositionRow[]>`. Keyset cursor = `(fix_time, rec_hash)` composite (PK order); ORDER BY fix_time ASC (chronologinis playback'ui), cursor = paskutinis (fixTime,recHash). limit clamp max 10_000 (§6.6). Sanitizuoti from/to/cursor kaip audit.ts (niekada 500). fix_valid įtraukiami (playback rodo gap'us I5).
- **Trips read repo** (packages/db/src/repos/trips.ts, Prisma scoped, read-only): `list(scope, {deviceId?, from?, to?, take?})` (index [tenantId,accountId,startTime] / [deviceId,startTime]), `get(scope, id)`. Wired į Db (db.ts + index.ts). BigInt id/deviceId.
- **API pool**: ApiDeps + `pool?: Pool` (createPool(databaseUrl) main.ts'e); apiManifest passuoja undefined. crud.ts positions handler naudoja deps.pool.
- **Routes** (crud.ts MANIFEST RouteDefs, scopeClass 'account', entity 'device', shape 'item'):
  - `GET /v1/devices/:id/positions` — pirma `db.devices.get(scopeOf(auth),id)` (404 jei ne scope), tada readPositions(pool, dev.id, ...). Grąžina serializuotą (recHash→string, fixTime→ISO). Isolation auto-covers (cross-tenant device → 404).
  - `GET /v1/devices/:id/trips` — device scope gate, tada db.trips.list(scope, {deviceId: dev.id, from, to}).
  - `GET /v1/trips/:id` — scoped trip get (isolation item route; idFor trip → f.tripId). Reikia fixtures seed trip.
- **Web playback** (`apps/web/src/routes/app/playback.tsx` + lib/playback.ts):
  - Device pasirinkimas + date range → fetch positions + trips.
  - MapLibre trail per buildTrailFeatures (reuse; solid + dashed invalid-fix I5). Stop markers = trip start/end taškai (markeriai). Timeline scrub = slankiklis per positions (index) → highlight taškas + centruoti mapą.
  - **Speed chart** = hand-rolled SVG (speed vs time), scrub sinchronizuotas (vertikali linija). Stop markers = trip ribos ant timeline.
  - i18n×4, nav (Fleet→History arba Devices detail „History" mygtukas → /app/playback?device=). Reuse map STYLE_URL.
- **Metrics**: nebūtina (read-only API); praleisti arba pridėti request counter (opcional).

## Failai

**Nauji:** `packages/db/src/positions.ts` (readPositions); `packages/db/src/repos/trips.ts` (TripReadRepo); `apps/api/__tests__/history.spec.ts` (positions+trips scoped read, cursor, garbage params, cross-tenant); `apps/web/src/{routes/app/playback.tsx, lib/playback.ts, components/SpeedChart.tsx}`; `apps/web/__tests__/playback.spec.ts` (query builder / chart scale unit); docs/epics/E04-3-plan.md.

**Keičiami:** `packages/shared/src/entities.ts` (Position/Trip/query schemos); `packages/db/src/{db.ts,index.ts}` (trips repo + readPositions export); `apps/api/src/{app.ts (ApiDeps.pool + wire), routes/crud.ts (3 routes + READ_POLICY nekeičiam — device policy=ALL ROLES, trip=ALL)}`; `apps/api/src/main.ts` (pass pool); `apps/web/src/{router.tsx, components/AppShell.tsx (nav History), i18n×4}`; `tests/isolation/{fixtures.ts (seed trip → tripId), suite.spec.ts (idFor trip)}`; README.

## Testai

- **history.spec** (api, pg+redis): GET positions savo device → chronologinis; from/to filtras; cursor puslapiavimas (10k clamp); garbage from/to/cursor → 200 ne 500; cross-tenant device :id → 404 (per db.devices.get gate). GET trips → scoped; GET /v1/trips/:id own→200 cross→404.
- **isolation**: /v1/devices/:id/positions + /trips + /v1/trips/:id auto-covered (device/trip scope). fixtures seed trip.
- **web unit**: speed chart scale (min/max→SVG coords) + playback query builder.
- **e2e**: login → playback (seeded device iš simulator drive) → trail matomas, scrub keičia highlight, speed chart rodo. (Priklauso nuo positions egzistavimo — e2e simulator jau įrašo positions; trips iš E04-1 engine.)

## Žingsniai

1. Branch + planas. ✅
2. shared Position/Trip/query → db readPositions + trips repo + Db wire → gates.
3. api ApiDeps.pool + 3 routes + main.ts pool → gates + history.spec.
4. isolation fixtures trip + suite → žalia.
5. web playback puslapis + SpeedChart + lib + nav + i18n → gates + e2e + web unit.
6. README → pilni gates → adversarinė peržiūra (fokusas: positions device-scope gate PRIEŠ read, cross-tenant leak; cursor/from/to sanitizacija ne 500; 10k clamp; BigInt/rec_hash serializacija; trip scope; I5 gap render; SVG chart XSS n/a; unbounded positions read) → PR → CI → merge → atmintis.

## Rizikos

- **Scope leak**: positions read PRIVALO eiti per db.devices.get(scope,id) gate PRIEŠ skaityti positions pagal dev.id — niekada raw :id. Trips per scoped repo.
- **Unbounded read**: limit clamp 10_000 (§6.6); cursor puslapiavimas.
- **Query param 500**: sanitizuoti from/to/cursor (audit.ts pattern) — isolation testuoja garbage→200.
- **Naujas dep chart**: VENGTI — hand-rolled SVG.
- **Pool į API**: naujas ApiDeps laukas; apiManifest (be pool) turi veikti (routes buduojami be handler vykdymo).
- **e2e trips**: playback e2e priklauso nuo positions (simulator rašo) + trip (engine); jei trip nesusidaro e2e window — rodyti bent trail+positions, trips optional.

## Verifikacija (DoD)

- Gates + history.spec + isolation + e2e žali; positions/trips scoped; cursor+clamp; garbage→200.
- Manual: playback puslapyje device+range → trail+scrub+speed chart+stop markers.
- §10 #7 (tenant leak): device-scope gate; isolation auto.
