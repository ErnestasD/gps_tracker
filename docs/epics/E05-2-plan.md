# E05-2 Plan — Geofence transition detection + geom cache (W5 S2)

> Autonominė sesija. Playbook: test-first (point-in-polygon + hysteresis engine — IP) → geom cache + Redis sync → worker wiring + events persist → gates → peržiūra → PR → CI → merge → atmintis.

**AC (§8 W5 S2):** transition detection w/ hysteresis (enter requires 2 consecutive fix_valid inside). §6.1: „evaluate rules (geofence transitions via cached prepared geoms)". I5: invalid fix niekada nekeičia geofence state.

## Sprendimai

- **point-in-polygon** (apps/worker/src/geofence/point.ts, gryna ray-casting, be dep): GeoJSON Polygon su holes (outer ring + holes). Planar lon/lat — puiki aproksimacija ≤10000km² geozonoms (area cap); PostGIS geography tikslus atitikimas reikalautų DB round-trip per fix (per lėta hot path). Antimeridian — out of scope v1.
- **GeofenceEngine** (engine.ts, gryna, per (device,geofence) hysteresis): fix_valid only (I5 dvigubas sargas); out-of-order drop per device (I2). Enter = enterStreak(2) iš eilės inside; exit = exitStreak(2) outside → GeofenceTransition {deviceId, geofenceId, name, type enter|exit, at, lat, lon}. State Map bounded by (device×geofence).
- **Redis sync** (api geofenceRegistry.ts): geofence CRUD → `geofence:tenant:{tenantId}` hash (geofenceId → {accountId, name, geometry}). crud.ts create/update → syncGeofence; delete → removeGeofence.
- **GeofenceCache** (worker cache.ts, TTL): resolveBatch(deviceIds) → device tenant/account (registry) + tenant fences (geofence:tenant:*, cached TTL) filtered by account (null=shared OR == device account) → Map<device, GeofenceDef[]>. Pre-resolve prieš sync engine feed (kaip configCache).
- **MotionFeed**: GeofenceQueueStub PAKEISTAS realiu GeofenceEngine; feed() grąžina {tripEvents, transitions} iš tų pačių I5-filtered records (viena filtracija).
- **Event persist** (writer.ts writeGeofenceEvents raw SQL → events kind='geofence' payload {geofenceId,name,transition}; persister.ts resolve device tenant/account, skip unregistered). Metric geofence_events_total.

## Failai

**Nauji:** apps/worker/src/geofence/{point,engine,cache,writer,persister}.ts; apps/worker/__tests__/{geofence-engine,geofence-cache,geofence-persister,geofence-writer}.spec.ts; apps/api/src/routes/geofenceRegistry.ts; docs/epics/E05-2-plan.md.

**Keičiami:** apps/worker/src/{motion.ts (MotionFeed→GeofenceEngine, {tripEvents,transitions}), main.ts (geofenceCache+persister wiring), prom.ts (geofence_events_total)}; apps/worker/__tests__/motion.spec.ts; apps/api/src/routes/crud.ts (sync on geofence CRUD); README.

## Testai

- **geofence-engine**: point-in-polygon (inside/outside/hole); enter needs 2 consecutive; exit needs 2; jitter no-transition; I5 (invalid ignored); out-of-order drop; per-device+geofence independence.
- **geofence-cache**: device→tenant/account→fences filtered by account (own+shared, not sibling); TTL; malformed skip; unregistered absent.
- **geofence-persister**: scoped event from registry; unregistered skip; batched.
- **geofence-writer** (pg): events row kind+payload+lat/lon.
- **motion**: MotionFeed returns {tripEvents, transitions} from same I5-filtered records.

## Rizikos

- **Planar vs geography containment**: ray-casting planar; area guard geography. ≤10000km² OK; antimeridian out of scope. Dokumentuota.
- **State/cache unbounded**: engine state (device×geofence) + cache (tenant) bounded; deleted geofence state lingers (minor, bounded) — prune V2.
- **Redis geofence backfill**: naujos geozonos sync per CRUD; jei Redis flush'inamas, reikia re-sync (API only writer). V1: nauja deploy'e nėra senų geozonų; startup backfill = V2. Note.
- **Cross-batch late**: geofence transitions stream-only; E04-2-style recompute geozonoms = V2.

## Verifikacija (DoD)

- Gates + geofence-engine/cache/persister/writer + motion žali.
- Manual: sukurti geofence → device važiuoja per ją → geofence event (kind='geofence') events lentelėje.
- §10 I5: invalid fix nekeičia geofence state (testas).
