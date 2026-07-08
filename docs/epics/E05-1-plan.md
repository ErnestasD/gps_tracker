# E05-1 Plan — Geofence CRUD + map editor (W5 S1)

> W5 pradžia. Autonominė sesija. Playbook: planas → ADR terra-draw → shared schema → geofence repo (PostGIS raw SQL, scoped) → API + isolation → web terra-draw editor → gates → peržiūra → PR → CI → merge → atmintis.

**AC (§8 W5 S1):** geofence CRUD + map editor (polygon/circle, terra-draw).

## Context

`Geofence` modelis egzistuoja: id, tenantId, accountId(nullable=tenant-shared), name, color(#hex), kind(polygon|circle), geom `geography(Polygon,4326)` (Unsupported Prisma → raw SQL), createdAt. NĖRA geofence repo. `terra-draw` NĖRA dep (MIT, MapLibre-native) → ADR-021. Circle irgi saugomas kaip Polygon (editor buferuoja apskritimą į poligoną). Area guard ≤10,000 km² (§6.3). scopedWhere jau turi nullableAccount (geofences tenant-shared).

## Sprendimai

- **ADR-021**: terra-draw (apps/web dep, MIT, MapLibre-native geofence editor).
- **shared** (entities.ts): `geoJsonPolygonSchema` (zod: type='Polygon', coordinates number[][][], ≥1 ring ≥4 taškų, uždaras), `geofenceCreateSchema` {name, color(#rrggbb), kind(polygon|circle), geometry: polygon}, `geofenceUpdateSchema` (partial). `GeofenceView` (geometry GeoJSON, id/tenant/account string).
- **geofence repo** (packages/db/src/repos/geofences.ts, prisma.$queryRaw — PostGIS in packages/db, scoped + audit): list/get (SELECT ... ST_AsGeoJSON(geom) scoped), create/update (INSERT/UPDATE geom = ST_GeomFromGeoJSON($json)::geography; **area guard** ST_Area(geom) ≤ 1e10 m² else GeofenceTooLargeError; **validity** ST_IsValid else GeofenceInvalidError), remove. Scope via raw WHERE = scopedWhere(nullableAccount) logika (tenantId=$ AND (accountId=$ OR accountId IS NULL) kai account-scoped). Audit entity 'geofence'.
- **API** (crud.ts manifest, scopeClass 'account', entity 'geofence'): GET/POST /v1/geofences, GET/PATCH/DELETE /v1/geofences/:id. READ_POLICY['geofence']=[...ROLES], WRITE=ACCOUNT_WRITERS. Area/invalid → 400. accountId create: account-scoped→pinned, tenant→data.accountId (null=shared).
- **web** (routes/app/geofences.tsx + lib/geofences.ts): sąrašas + MapLibre žemėlapis su **terra-draw** (polygon + circle modes) → nubraižytas geom → GeoJSON → POST/PATCH. Redaguoti/trinti. Spalva. nav Automation→Geofences (placeholder → route). i18n×4.

## Failai

**Nauji:** docs/adr/021-terra-draw.md; packages/db/src/repos/geofences.ts (+GeofenceTooLargeError/GeofenceInvalidError); apps/api/__tests__/geofences.spec.ts; apps/web/src/{routes/app/geofences.tsx, lib/geofences.ts, components/GeofenceEditor.tsx}; apps/web/__tests__/geofences.spec.ts; docs/epics/E05-1-plan.md.

**Keičiami:** packages/shared/src/entities.ts (geo schemas); packages/db/src/{db.ts,index.ts} (geofences repo); apps/api/src/routes/crud.ts (routes + READ/WRITE policy); apps/web/src/{router.tsx, components/AppShell.tsx (geofences nav), i18n×4}; tests/isolation/{fixtures.ts (seed geofence via pool ST_GeomFromGeoJSON), suite.spec.ts (idFor geofence)}; apps/web/package.json (+terra-draw); README.

## Testai

- **geofences.spec** (api pg): create polygon → get returns GeoJSON; area>10000km² → 400; invalid polygon → 400; scoped (account-shared visible; cross-account 404 via isolation); update geom; delete. Tenant-shared (accountId null) visible to account users.
- **isolation**: /v1/geofences item routes auto-covered (account scope; tenant-shared null nuance — seed an account-scoped geofence for cross-account 404).
- **web unit**: GeoJSON polygon validity + close-ring helper; color validation.
- **e2e**: login → Geofences → draw a polygon (terra-draw) → save → appears in list → shown on map. (terra-draw headless — assert the saved geofence renders; drawing interaction may be simulated via the editor's API.)

## Žingsniai

1. Branch + planas + ADR-021. ✅ (branch)
2. shared geo schemas → geofence repo (PostGIS raw SQL) → Db wire → gates + geofences.spec.
3. API routes + policy + isolation fixtures → suite žalia.
4. web terra-draw editor + list + nav + i18n → gates + e2e + web unit.
5. README → pilni gates → adversarinė peržiūra (fokusas: geofence tenant/account scope (raw SQL WHERE — no leak); area guard; ST_IsValid (self-intersecting poly); GeoJSON injection into ST_GeomFromGeoJSON (parameterized); tenant-shared null visibility; I5 note (geofence eval E05-2, not here); XSS in name/color) → PR → CI → merge → atmintis.

## Rizikos

- **PostGIS raw SQL scope leak**: WHERE privalo pinti tenantId + account (nullableAccount) — parameterized, ne string concat. Isolation įrodo.
- **GeoJSON injection**: ST_GeomFromGeoJSON($1) parameterized (JSON string param) — ne concat.
- **Area/validity**: ST_Area guard + ST_IsValid (self-intersect → 400).
- **terra-draw naujas dep**: ADR-021.
- **Circle**: editor buferuoja į poligoną (terra-draw circle mode → polygon); backend kind=circle metadata, geom=polygon.
- **E05-2 transition eval** (hysteresis, geom cache) — NE šioje story, tik CRUD+editor.

## Verifikacija (DoD)

- Gates + geofences.spec + isolation + e2e žali; area/validity guards; scoped.
- Manual: nubraižyti geofence → išsaugoti → sąraše + žemėlapyje; per didelis → klaida.
