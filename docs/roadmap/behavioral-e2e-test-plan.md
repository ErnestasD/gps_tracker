# Behavioral / E2E Test Plan (Layer 2) — moving fleets exercising features end-to-end

**Date:** 2026-08-20 · **Status:** ready to implement (hand-off to implementing agent) · not yet built.
**Method:** 7-agent validation workflow re-verified the engine choice AND cross-checked every claim
against the live repo (seeded polygon/rule, overspeed semantics, WS payload, offline fire-once,
Testcontainers scaffold). Composes with **Layer 1** (`docs/roadmap/no-hardware-testing-stack.md`):
Layer 1 owns "are the bytes/ACK correct"; **this plan owns "does a moving fleet make
geofence/overspeed/trip/offline/live-map WORK end-to-end."**

## Engine decision (validated)
Build on **our own `@orbetra/simulator`** (fleet mode `--devices N`, `liveDrive` over
`routes/vilnius-loop.geojson`, seeded LCG, targets any `--host/--port`). It is the correct and
sufficient engine for the behavioral layer. **Do not adopt any online "moving-device" service into CI.**
- **Telemify** — MANUAL / out-of-CI only (external cloud, non-deterministic, Codec 8/8E only,
  ~30-device concurrency, undisclosed residency). Fine as an encoder-oracle + live-map demo; never a gate.
- **flespi TrackBox** — REJECTED for this layer (emits into flespi's own REST/MQTT, cannot send raw TCP
  to our ingest).
- **gpsd / OsmAnd / OwnTracks** — REJECTED (wrong protocol layer; not Teltonika-binary movers).

Supporting tools ADDED to this layer (all offline/free, need an ADR per CLAUDE.md rule 10):
**Toxiproxy** (MIT, network fault injection), **Pumba** (Apache-2.0, container-kill chaos),
**mapbox-gl-framerate** (ISC, advisory FPS — never a gate).

## 0. Objectives & behaviors to cover
1. Geofence enter/exit (hysteresis enterStreak=exitStreak=2), correct fence id, ordered enter→exit, UTC.
2. Overspeed — **Orbetra semantics: LEVEL kind, fires on first valid-fix record where speed>limit,
   repeats gated by cooldownS (`apps/worker/src/rules/engine.ts:141-147`). NOT a 15 s dwell.** Assert one
   event per crossing within cooldown; assert none below threshold; assert invalid-fix never fires
   (fixValid guard).
3. Trip open/close + distance (opens on ignition/motion, closes on parkTailS tail); distance EXCLUDES
   invalid-fix points (Hard Rule 6 / I5).
4. Offline→online — device_offline fires ONCE per episode, clears on recovery (`rules/offline.ts`,
   60 s sweep). Presence uses server lastContact, not device clock.
5. Live-map / WS latency — WS `live:{tenantId}` carries POSITIONS ONLY (`worker/liveState.ts`). Assert
   last-TCP-write→WS-frame delta < 2000 ms. Events are NOT on WS — assert them via GET /v1/events.
6. Invalid-fix gap — satellites==0 ⇒ fix_valid=false must NOT move geofence state, trip distance, or
   overspeed (Hard Rule 6). One dedicated variant per affected behavior.
7. Buffered-flood ordering — reconnect replays buffered records oldest-first; assert zero loss, no
   duplicate/re-fired geofence/overspeed events, correct trail reconstruction (ACK-after-XADD, Rule 4).
8. Clock-skew — future/past/out-of-order timestamps: presence correct, geofence doesn't flip on stale
   records (I2 out-of-order drop), offline uses server time.
9. 500-device map perf — sustained FPS floor + no long-task starvation (ADVISORY, non-gating).
10. Multi-tenant isolation UNDER LOAD — ≥2 tenants driven concurrently; each API/WS sees only its own.
11. Worker-kill chaos mid-drive — zero position loss, no dropped/duplicated events, ordered recovery.

## 1. Preconditions (verified in repo — read these first)
- Seeded geofence polygon (lon,lat): `[[25.26,54.67],[25.30,54.67],[25.30,54.70],[25.26,54.70]]` and
  overspeed rule `Greičio viršijimas 90` (config.speedKmh:90) — `tools/seed-demo/src/seedScenarios.ts:266,271`.
  Engines read Redis, not the DB row — ensure the seed sync ran.
- Simulator contract: scenarios implement `packets(opts: ScenarioOpts): Iterable<Buffer>`; opts carry
  seed, startMs, count, hz, parkTailS, startDistanceM (`tools/simulator/src/scenarios/types.ts`).
  Register new scenarios in `tools/simulator/src/main.ts` `SCENARIOS`.
- Harness: `apps/web/tests/pw/stack.ts` stands up Redis + TimescaleDB (Testcontainers) + ingest/api/worker
  via tsx + seeds a tenant; `smoke.spec.ts` asserts via DOM + `map.queryRenderedFeatures` (NOT canvas pixels).
- API surface (scoped repos only, never positions ORM): GET /v1/events, /v1/events/:id, /v1/trips,
  /v1/devices/:id/trips, /v1/devices/:id/positions, WS GET /v1/stream?ticket=…
  (`crud.ts:2031/2052/831`; `ws.ts:124`).
- MANDATORY FIRST READS before setting scenario durations (do not guess constants):
  `apps/worker/src/geofence/engine.ts` (enterStreak/exitStreak=2, isClockSkewed), `rules/engine.ts`
  (overspeed level+cooldownS), `rules/offline.ts` (fire-once/60 s sweep), `liveState.ts` (presence, skew).

## 2. Scenarios to add — tools/simulator/src/scenarios/ (all seeded; register in main.ts)
Fixtures first (CLAUDE.md workflow §2). Add under `tools/simulator/src/routes/`:
- `geofence-cross.geojson` — start OUTSIDE (~25.24,54.68) → cut through interior (25.28,54.685) → exit
  (~25.32,54.68). Must yield ≥2 consecutive interior fixes and ≥2 exterior fixes (satisfy streak=2).
  Author MUST verify the line actually intersects the seeded polygon before committing.

| Scenario file | Drives | Asserts |
|---|---|---|
| geofenceCross.ts | geofence-cross.geojson @1Hz, valid fix | enter then exit event, correct fence id, ordered, UTC, no flap/dup |
| geofenceCrossInvalidFix.ts | same route, satellites==0 inside fence | NO enter event (Rule 6) |
| overspeed.ts | route segment seeded speed >90 (e.g. 95) sustained a few records | exactly one overspeed event at crossing (cooldownS-gated), reported speed+limit; none while ≤90 |
| overspeedInvalidFix.ts | speed >90 but satellites==0 | NO overspeed event (fixValid guard) |
| tripLifecycle.ts | ignition on → drive vilnius-loop → parkTailS tail | one trip opens+closes; distanceKm within tolerance of known route length; invalid-fix points excluded |
| offlineFlap.ts | drive, withhold emit > offline threshold, resume | device_offline fires ONCE then clears; presence on server time |
| clockSkew.ts | future/past/out-of-order timestamps | presence correct; geofence doesn't flip on stale; offline uses server time |
| (extend) bufferedFlood.ts | existing flood + behavioral assertions | zero loss (sent==acked), no re-fired geofence/overspeed, trail reconstructed |

Reuse existing `invalidFix.ts` / `slowLoris.ts` / `bufferedFlood.ts` building blocks; do not duplicate framing.

## 3. Assertion layers
**A. Deterministic CI (BLOCKING)** — new package `tools/e2e-behavior/` (Vitest), wrapping `stack.ts`:
- Per scenario: run simulator against local ingest with fixed seed + startMs.
- REST poll-until (10 s budget) GET /v1/events & /v1/trips; assert kind, ordering, fence id,
  distanceKm tolerance, and the NEGATIVE/invalid-fix cases.
- Open GET /v1/stream?ticket=…; assert last-write→frame latency < 2000 ms.
- Read back ONLY via scoped repos / REST / WS. All time assertions UTC. Assert `ingest_*`,
  `pipeline_lag_ms`, `stream_depth` move as expected (metrics touched → CLAUDE.md workflow §4).

**B. Chaos (BLOCKING, offline, zero-egress):**
- Toxiproxy via `@testcontainers/toxiproxy` + `toxiproxy-node-client`: proxy sim↔ingest, ingest↔Redis,
  worker↔Timescale; inject latency/timeout/reset_peer. Assert ACK only after XADD survives a Redis
  stall; ingest back-pressures (no loss); slow-loris/timeout paths hold.
- Pumba: `pumba kill` the worker mid-drive; assert zero position loss, no dropped/duplicated
  geofence/trip events, ordered per-shard recovery (imei%16, Rule 5).

**C. Load/soak (BLOCKING for loss/lag, ADVISORY for soak):** `runFleet` ≥200 devices; assert sent==acked
(FleetResult), bounded `stream_depth`, `pipeline_lag_ms` p99 under budget; soak = flat RSS + caggs keep
up. Feed `tools/replay` redacted real logs for realism.

**D. Multi-tenant-under-load (BLOCKING):** `runFleet` across ≥2 seeded tenants concurrently; assert each
tenant's API/WS sees only its own devices/events. Combine with `pnpm test:isolation` harness.

**E. Playwright visual (NON-BLOCKING, GPU/xvfb lane):** extend `smoke.spec.ts` — drive liveDrive, assert
the vehicle map source feature coordinate advances via `page.evaluate(window.__map source features)`,
NOT canvas pixels. Prefer exposing `window.__map` over MapGrab (archived read-only 2025-07-14).

**F. Map-FPS@500 (ADVISORY artifact only):** mapbox-gl-framerate under a test flag; record FPS + long-tasks
as a trend, never a hard gate (headless WebGL FPS is noisy).

## 4. Files to create / commands
- `tools/simulator/src/routes/geofence-cross.geojson` (+ verify intersection)
- `tools/simulator/src/scenarios/{geofenceCross,geofenceCrossInvalidFix,overspeed,overspeedInvalidFix,tripLifecycle,offlineFlap,clockSkew}.ts` ; register all in `tools/simulator/src/main.ts` SCENARIOS.
- `tools/e2e-behavior/` (Vitest + stack.ts reuse): one spec per scenario + isolation-under-load spec.
- Chaos: add Toxiproxy proxies into `stack.ts`; worker-kill spec (Pumba or docker kill).
- Extend `apps/web/tests/pw/smoke.spec.ts` with the map-advance watch; add `window.__map` exposure under
  a test flag in apps/web.
- Run: `turbo run test --filter=@orbetra/simulator` ; `pnpm --filter @orbetra/web e2e` ;
  `pnpm test:isolation` ; sim against staging: `pnpm sim --scenario geofenceCross --host 185.80.129.33 --port 5027 --seed 42` (manual demo only).
- Deps need an ADR (CLAUDE.md rule 10): `@testcontainers/toxiproxy` + `toxiproxy-node-client` (dev),
  Pumba (CI binary, not a runtime dep), mapbox-gl-framerate (dev, advisory). Write a `docs/adr/` entry.

## 5. Ordered steps (acceptance criteria per step)
1. Read the 4 engine files in §1; write down actual enterStreak, cooldownS default, offline threshold,
   presence-timeout. **AC:** constants documented in the test package README; no guessed durations remain.
2. Author + verify `geofence-cross.geojson`. **AC:** an offline point-in-polygon check proves ≥2 interior
   and ≥2 exterior consecutive fixes against the seeded polygon.
3. Implement geofenceCross + geofenceCrossInvalidFix; register. **AC:** local run produces exactly one
   enter+exit for valid fix, zero enter for invalid-fix, correct fence id, UTC.
4. Implement overspeed + overspeedInvalidFix. **AC:** one overspeed event at crossing, none ≤90, none for
   invalid-fix; reported speed+limit correct; cooldownS respected on a held-over segment.
5. Implement tripLifecycle. **AC:** one trip opens+closes; distanceKm within tolerance; invalid-fix excluded.
6. Implement offlineFlap + clockSkew. **AC:** device_offline fires once + clears; skewed/out-of-order
   records don't flip geofence/presence.
7. Stand up `tools/e2e-behavior/` over stack.ts with REST-poll + WS-latency assertions for steps 3-6.
   **AC:** deterministic green twice in a row (same seed), offline, < ~3 min.
8. Add Toxiproxy + worker-kill chaos specs. **AC:** Redis-stall keeps zero loss; worker-kill recovers with
   zero loss + no dup/dropped events, ordered per shard.
9. Add load/soak + multi-tenant-under-load. **AC:** sent==acked, bounded stream_depth, p99 lag under budget,
   tenant B never sees tenant A.
10. Extend Playwright watch + wire map-FPS advisory on the GPU/xvfb lane. **AC:** marker advances;
    FPS/long-task artifact emitted; lane is non-blocking.
11. CI wiring: steps 3-9 are the blocking gate (deterministic/offline/free/EU-local); step 10 non-blocking.
    Optional staging smoke on 185.80.129.33:5027, never the deterministic gate.

## 6. Residency & determinism
All of §3.A-D is offline, free, zero data-egress → EU-residency clean; keep it the source of truth.
Every scenario seeded (LCG) + fixed startMs + fixed count → reproducible. Synthetic routes only.
STAYS MANUAL / out-of-CI: Telemify (external cloud, non-deterministic — encoder-oracle + live-map demo
only), map-FPS gate, any staging run (shared mutable state).

## 7. Composition with Layer 1
Layer 1 (`no-hardware-testing-stack.md`): Traccar decoder-diff (Axis A, decode/value across 6 families)
+ Scapy ACK/resend harness (Axis B, transport/framing — owns the Codec-16 resend + park-frame/ACK bugs)
+ boofuzz nightly. Those prove the BYTES and the ACK state machine. THIS plan assumes those are green and
proves the FEATURES a moving fleet drives. No overlap except Telemify's encoder-oracle role, which is
redundant with Traccar decode-diff — so Telemify stays demo-only.

## 8. Honest limits — still needs real hardware
- A synthetic Vilnius-loop is not real GPS noise; pair with `tools/replay` on redacted real logs.
- 500 in-process sessions share one Node event loop; true >1-2k-device scale needs multiple generator
  hosts (generator is the bottleneck, not the pipeline — per prior load test).
- Headless-CI WebGL FPS is inherently noisy → map-perf is a regression trend, never a hard gate.
- NONE of this substitutes for hardware FTC887 validation: carrier/device-side bugs (e.g. the Twilio
  U+202F/Smart-Encoding SMS-spacing class) are invisible to any simulator — they live in the real
  carrier/device path. Keep the hardware track separate and mandatory before go-live.

---
**Implementer note — one correction carried into this plan:** the widely-cited "Traccar 15 s overspeed
dwell" pattern does **not** apply. Orbetra's overspeed engine fires immediately on the first valid-fix
over-limit record and gates repeats by `cooldownS` (`apps/worker/src/rules/engine.ts:141-147`). The §2
scenarios assert against that real behavior, not the Traccar oracle. Everything else verified clean
against the repo (seeded polygon/rule, `enterStreak/exitStreak=2`, WS = positions-only, fire-once offline,
Testcontainers scaffold present).
