# IMPLEMENTATION_PLAN.md — Detailed Epic & Story Backlog (v2)
**Companion to:** PROJECT_PLAN.md (normative spec) · CLAUDE.md (hard rules) · CC_PLAYBOOK.md (how to run CC)
**Story IDs are stable** — CC_PLAYBOOK and PR titles reference them; never renumber.

**Story template:** Context → Files → Approach → AC (checkboxes, all must pass) → Tests (named files/scenarios) → Edge cases → NOT in this story → Size/Depends.
**Sizing:** S ≈ ≤0.5 dev-day · M ≈ 1 · L ≈ 2. Any story exceeding its size gets split at the pre-marked cut line.
**Definition of Ready:** cited PROJECT_PLAN §; AC executable; dependencies merged. **Definition of Done:** CLAUDE.md checklist.
**One story = one CC session = one branch = one PR.**

---

## E00 — Pre-flight (humans; blocks nothing in code but blocks reality)
- **E00-1** Hardware: order 2×FMB920, 1×FMB120, 1×FMC130, 1×TAT100 + 5 SIMs (1NCE or Things Mobile, data-only, EU roaming). Mount FMBs on founders' cars (ignition wire connected — trip engine needs AVL 239). TAT100 stays on a desk (asset-profile testing). *Deadline: order day 1; devices are the critical path for E01-6/E02-8.*
- **E00-2** Infra accounts: Hetzner AX42 **or equivalent KVM VDS (e.g., vpsnet VDS 8vCPU/32GB/300GB NVMe — must be KVM, not paravirt VPS, for Docker); final placement decided by E07-3 load gate** + staging cloud instance + Storage Box/S3-compatible offsite; domain; GitHub org; **AWS SES eu-central-1 production access request (takes days — submit day 1)**; Cloudflare R2 bucket.
- **E00-3** Channel numbers from friend: monthly device flow from platform-less buyers, DE/PL/Baltics split, top-5 models in that flow, 2–3 named pilot candidates.
- **E00-4** Telegram bot via BotFather; token to secrets store. Decide bot display name (white-label-neutral).
- **E00-5** Product name decision: Orbetra is a CODENAME — check trademark (EUIPO quick search), domain availability, and PL/DE pronunciation before the public site ships. Blocking for E09-4, not for code.

---

## E01 — Skeleton & first byte (W1) — *Epic exit: a founder's real car produces a row in `positions`.*

### E01-1 · Monorepo scaffold & CI (M)
**Implements:** PROJECT_PLAN §5 map, §9.4 hooks.
**Context:** everything downstream assumes these gates exist; building them later means retrofitting discipline.
**Files:** `package.json` (pnpm workspaces), `turbo.json`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `vitest.workspace.ts`, `.github/workflows/ci.yml`, package stubs per §5 map (`apps/{ingest,worker,api,web}`, `packages/{codec,db,shared}`, `tools/{simulator,replay,redact}`), `scripts/hook-gate.sh`, `scripts/hook-commit-gate.sh`, `.claude/settings.json`, `Makefile`.
**Approach:** pnpm + Turborepo pipelines (`typecheck`,`lint`,`test`,`build`) with per-package caching; ESLint flat config with two custom rules wired: `no-restricted-imports` banning `@prisma/client` outside `packages/db`, and `@typescript-eslint/no-floating-promises` as error; CI = install → turbo run typecheck lint test (affected graph on PRs, full on main).
**AC:**
- [ ] `pnpm i && pnpm turbo run typecheck lint test` green on fresh clone
- [ ] PR with a deliberate type error → CI red; with `@prisma/client` import in apps/api → lint red
- [ ] hook-gate.sh runs affected package gates when CC edits a file (manual verification with a scratch edit)
- [ ] commit with `TODO(VERIFY-WIKI)` in staged diff is blocked by commit-gate
**Tests:** CI itself is the test; add `scripts/__tests__/hooks.spec.sh` (bats or plain sh assertions).
**Edge cases:** hook must no-op gracefully for non-package paths (docs/, root configs).
**NOT here:** any app logic; Docker images (E01-2).
**Depends:** —

### E01-2 · Infra: compose + Ansible + free-stack services (M)
**Implements:** §5 infra, §2 links (Photon, GlitchTip, Uptime Kuma), cost table.
**Files:** `infra/ansible/{site.yml,roles/{base,docker,caddy,ufw}}`, `infra/compose/{docker-compose.yml,docker-compose.staging.yml}`, `infra/Caddyfile`, `.worktreeinclude`, `infra/photon/README.md`.
**Approach:** single-host compose: `pg16` image with timescaledb+postgis extensions, `redis:7` (appendonly everysec), `photon` (rtuszik/photon-docker, `REGION=pl,lt` db-mode extracts), `glitchtip`, `uptime-kuma`, `prometheus+grafana+loki+promtail`, `caddy` (reverse proxy, on-demand TLS ask endpoint stubbed to deny-all until E03-5). Ansible: UFW (allow 22, 80, 443, 5027), unattended-upgrades, Docker install, deploy user.
**AC:**
- [ ] `make up` boots the full stack locally in <3 min
- [ ] staging reachable over TLS; Grafana/Kuma/GlitchTip behind basic auth
- [ ] `curl "$GEOCODER_URL/reverse?lat=54.6872&lon=25.2797"` returns a Vilnius address
- [ ] port 5027 open and reachable from the public internet on staging
- [ ] `CONFIG GET maxmemory-policy` returns noeviction (asserted in smoke test); chrony synced
**Tests:** `infra/smoke.sh` executed by CI against ephemeral compose (services healthy, photon responds).
**Edge cases:** Photon first boot downloads GBs — healthcheck must tolerate long warmup (start_period ≥ 15 min); document disk needs.
**NOT here:** backups (E07-2), alert rules (E07-1), tenant custom domains (E03-5).
**Depends:** E00-2.

### E01-3 · DB layer: Prisma schema + SQL migrator + hypertable (M)
**Implements:** §6.3 full table list + DDL verbatim.
**Files:** `packages/db/prisma/schema.prisma` (tenants, accounts, users, device_profiles, devices, raw_rejects, trips, geofences, rules, events, commands, api_keys, webhooks, usage_daily, audit_log, geocode_cache, tenant_domains), `packages/db/sql/001_positions.sql` (DDL from §6.3 EXACTLY, incl. comments), `packages/db/sql/migrate.ts` (tiny runner: applied-migrations table, lexical order, transactional per file), `packages/db/src/pool.ts`.
**Approach:** Prisma migrate for relational; raw SQL runner executes after Prisma in `make migrate`. geofences.geom as `Unsupported("geography")` in Prisma with raw accessors.
**AC:**
- [ ] `make migrate` from empty DB, then again → idempotent, zero diff
- [ ] **compressed-chunk verification:** script inserts rows, `SELECT compress_chunk(...)`, inserts a late row with same-PK-shape into that chunk; outcome (works / needs decompress) written to `docs/audit/ts-compressed-insert.md` with TS version pinned
- [ ] retention & compression policies visible in `timescaledb_information` views
**Tests:** `packages/db/__tests__/migrate.spec.ts` (testcontainers: fresh → migrate → assert tables/policies); compressed-insert test as above.
**Edge cases:** migrator must refuse to run if an applied file's checksum changed (append-only enforcement).
**NOT here:** repositories (E03-2), seed data.
**Depends:** E01-1.

### E01-4 · Codec package: parser wrap + dictionaries + golden corpus (L; cut line: corpus+wrapper ‖ dictionaries)
**Implements:** §3 entire, §2 parser links, CLAUDE.md rules 8–9.
**Files:** `packages/codec/src/{index.ts,frame.ts,parse.ts,avl.ts,codec12.ts,crc16.ts}`, `packages/codec/dictionaries/{fmb1xx.json,fmc.json,fmb6xx.stub.json,tat.json}`, `packages/codec/__fixtures__/{wiki/*.hex.json,traccar/*.hex.json,captures/*.bin}`, `tools/redact/index.ts`.
**Approach:** vendor ONE npm parser (evaluate `complete-teltonika-parser` vs `teltonika-codec-parser` against corpus in first hour; pick, wrap, never expose its types). Public surface = Appendix A contracts only. `frame.ts` implements the streaming framer (see E01-5 note) here so both ingest and simulator reuse it. Dictionaries generated by hand from wiki tables with `source_url`+`retrieved_at`; loader validates JSON schema. crc16.ts implements CRC-16/IBM independently (used to VERIFY parser output and by simulator).
**AC:**
- [ ] every wiki Codec-page hex example parses byte-exact; the worked example asserts GSM=3 (AVL 21), DIN1=1, ExtVoltage=0x5E0F (AVL 66), ActiveOperator (AVL 241), iButton (AVL 78)
- [ ] Traccar-harvested packets (≥10, attribution header) parse without throw; unknown IDs land as `io_<id>`
- [ ] Codec 8 AND 8E fixtures both covered; Codec 16 parses to raw-fallback structure; Codec 12 encode(getinfo)→bytes matches wiki example, decode(response) yields ASCII text
- [ ] invalid CRC → `CrcError` with offending frame attached; NumberOfData1≠2 → `FrameError`
- [ ] branch coverage ≥95%; property test parse(encode(x))≡x on generated records
- [ ] simulator-engine ADR recorded (Go lib license verified OR TS encoder chosen — encoder lives here either way for TS path)
**Tests:** `__tests__/{wiki.spec.ts,traccar.spec.ts,frame.spec.ts,crc.spec.ts,codec12.spec.ts,property.spec.ts}`.
**Edge cases (must have fixtures):** packet split mid-length-field across reads; two packets in one read; coordinate with sign bit set (southern hemisphere); timestamp at exactly window edges; zero-record packet.
**NOT here:** any network I/O beyond frame.ts pure functions; DB writes.
**Depends:** E01-1.

### E01-5 · Ingest TCP server (L; cut line: framing/handshake ‖ stream-write/ACK/limits)
**Implements:** §3.2, §6.1 top half, security note.
**Files:** `apps/ingest/src/{server.ts,session.ts,registry.ts,limits.ts,metrics.ts,main.ts}`.
**Approach:** Node `net` server; per-socket Session state machine: `AWAIT_IMEI → STREAMING`; IMEI lookup via Redis hash `registry:imei` (deviceId or null → 0x00 + `quarantine:imei` sorted-set add + close after 3 rejected attempts/hr per IMEI); STREAMING loop: framer (from packages/codec) → CRC → parse → sanity per-record (fix_valid, ts window; rejects → `raw_rejects` via fire-and-forget worker queue `rejects`) → `XADD raw:{imei%16} * payload <cbor>` → write 4-byte BE count → check `XLEN` cached (per-shard, refreshed 1 s) → pause/resume. Codec 12 frames arriving from device are responses: push to `cmd:resp:{deviceId}` list (consumed by E08-2 backend). SO_KEEPALIVE(60 s); read-idle timeout from profile default 40 min (registry carries profileId); per-IP counter in `limits.ts` (Map + sliding window), handshake timeout 10 s.
**AC:**
- [ ] happy path: simulator live-drive → rows in stream, correct ACK counts
- [ ] corrupt-CRC packet → ACK = good-record count (0 if all bad), session survives
- [ ] declared length > 4096 → socket closed, `ingest_frame_violations_total` incremented
- [ ] unknown IMEI → 0x00 reply, appears in quarantine set
- [ ] 201st concurrent conn from one IP refused; slow-loris (header trickle) killed at 10 s
- [ ] backpressure: shard flooded past 50k → sockets on that shard paused (assert via metric + resumed after drain)
- [ ] kill -9 ingest mid-batch, restart: device (simulator) re-sends unACKed batch; no gap after E02-3 processes (deferred assertion, wired in E02-3 chaos test)
**Tests:** `apps/ingest/__tests__/{session.spec.ts,limits.spec.ts}` + e2e `tests/e2e/ingest.spec.ts` (compose + simulator scenarios: happy, corrupt-crc, oversize, slow-loris).
**Edge cases:** IMEI packet split across reads; device sends data before 0x01 sent (buffer, don't crash); duplicate IMEI second socket (policy: newest wins, old socket closed with log — matches device reconnect behavior).
**NOT here:** business logic, DB inserts, Codec 12 *sending* (E08-2).
**Depends:** E01-4; E02-1 (min scenarios) — build order: E02-1 first.

### E01-6 · First real device online (S)
**Files:** `docs/onboarding/point-device.md` (draft).
**Approach:** configure FMB920 via SMS (` setparam 2004:<host>;2005:5027;2006:0`-style — exact IDs verified against wiki FMB configuration page while writing the doc) and via Configurator; register IMEI in registry (temp CLI `pnpm registry:add <imei>`); watch it land.
**AC:** [ ] real position row in `positions` (via temporary direct-insert worker stub if E02-3 not merged; remove stub in E02-3) · [ ] doc contains both SMS and Configurator paths with screenshots.
**Depends:** E01-2,3,5; E00-1.

---

## E02 — Simulator & pipeline (W1–W2) — *Epic exit: 5 real devices live on map; SIM-pull flood test signed off.*

### E02-1 · Simulator v0 (M)
**Implements:** §7.2.
**Files:** `tools/simulator/src/{main.ts,scenarios/{liveDrive.ts,corruptCrc.ts,oversize.ts},encode.ts,routes/vilnius-loop.geojson}`.
**Approach:** encoder per E01-4 ADR (Go binary shelled OR TS encode.ts using packages/codec builders + crc16). Scenario interface: `{name, run(conn, opts): AsyncIterator<Frame>}`. CLI: `sim --scenario liveDrive --imei 356... --host ... --port 5027 --hz 1`. liveDrive walks a GeoJSON route emitting AVL with ignition=1, movement=1, speed from segment geometry.
**AC:** [ ] all three scenarios runnable; liveDrive produces protocol-valid frames (round-trip through packages/codec) · [ ] deterministic with `--seed`.
**Tests:** `tools/simulator/__tests__/encode.spec.ts` (frames re-parse identically).
**NOT here:** flood/panic/invalid-fix (E02-2).
**Depends:** E01-4.

### E02-2 · Simulator v1: adversarial scenarios (M)
**Files:** `scenarios/{bufferedFlood.ts,invalidFix.ts,panic.ts,slowLoris.ts}` + `tests/e2e/scenarios.spec.ts` CI job.
**Approach:** bufferedFlood: connect, send N (default 300) records timestamped now−2h..now oldest-first in max-size packets, at wire speed; invalidFix: interleave satellites=0 records carrying last-valid coords per §3.4; panic: priority=2 with DIN1 event; slowLoris: 1 byte/5 s.
**AC:** [ ] CI e2e job runs every scenario against compose stack green · [ ] flood scenario emits packets at ≥ the 1280-byte cap boundary (framing stress).
**Depends:** E02-1.

### E02-3 · Worker pipeline core (L; cut line: writer+dedupe ‖ ordering/recovery/chaos)
**Implements:** §6.1 bottom half; invariants I1–I3; Appendix A `NormalizedRecord`.
**Files:** `apps/worker/src/{consumer.ts,shards.ts,normalize.ts,writer.ts,liveState.ts(stub),main.ts}`, `packages/shared/src/records.ts`.
**Approach:** consumer group `pipeline`, worker claims shard set from `shards:lease` (Redis, TTL lease → exclusive ownership); per shard strictly serial: XREADGROUP batch ≤200 → normalize (dictionary decode via profile; compute fix_valid, extract ignition/movement/odometer; everything else → attrs) → writer builds ONE multi-row `INSERT ... ON CONFLICT (device_id,fix_time,rec_hash) DO NOTHING` (≤500 rows; parameterized; rec_hash = xxhash64→signed BigInt) → XACK. XAUTOCLAIM(min-idle 60 s) on start + every 30 s for crashed peers. Records within a batch sorted by fix_time before downstream handoff.
**AC:**
- [ ] **I1 test:** ACKed-by-ingest count == XLEN delta == rows inserted (happy path)
- [ ] **I2 test:** bufferedFlood interleaved with live records → downstream handoff strictly fix_time-ordered per device
- [ ] **I3 test:** replay identical batch twice → row count unchanged
- [ ] chaos: `kill -9` worker mid-batch → second worker XAUTOCLAIMs → zero loss, zero dupes (asserted against simulator's sent-count)
- [ ] SIGTERM: current batch completes + XACK + shard lease released <5 s (graceful-deploy test)
- [ ] rec_hash test includes a value > 2^63−1 (signed reinterpretation proven)
- [ ] throughput: 1,500 rec/s sustained 60 s on dev machine without lag growth (pre-gate for E07-3)
**Tests:** `apps/worker/__tests__/{normalize.spec.ts,writer.spec.ts,ordering.spec.ts}` + `tests/e2e/pipeline-chaos.spec.ts`.
**Edge cases:** batch containing multiple devices→ multiple shard writes? (No: one stream=one shard=many devices; serial per shard satisfies per-device order — document why); malformed CBOR entry → dead-letter `raw:dead` + continue.
**NOT here:** rules, trips, WS (stubs only).
**Depends:** E01-3,4,5.

### E02-4 · Live state + WS gateway (M)
**Implements:** §6.1 live path, §6.6 ws-ticket.
**Files:** `apps/worker/src/liveState.ts`, `apps/api/src/{ws.ts,routes/wsTicket.ts}`, `packages/shared/src/liveEvents.ts`.
**Approach:** liveState: `HSET device:{id}:last` ONLY if incoming fix_time > stored (max-wins), publish `live:{tenantId}` compact JSON; ws.ts: `GET /v1/ws-ticket` (auth'd) → random 32B token in Redis `SETEX ticket:{t} 30 userId` single-use (GETDEL on connect); WS subscribes to tenant channel, filters by account scope server-side.
**AC:** [ ] simulator send → WS message <2 s · [ ] bufferedFlood old records do NOT regress `last` (test) · [ ] ticket reuse → connection refused; >30 s ticket → refused · [ ] user of account A never receives account B device events (scope test).
**Tests:** `apps/api/__tests__/ws.spec.ts`, `apps/worker/__tests__/liveState.spec.ts`.
**Depends:** E02-3, E03-1 (login for ticket; can stub a single test user until E03-1 merges — remove stub then).

### E02-5 · Backpressure, metrics, dashboard (M)
**Files:** `apps/{ingest,worker}/src/metrics.ts` (prom-client), `infra/grafana/dashboards/ingest.json`, `infra/prometheus/prometheus.yml`.
**Metrics (names frozen — Appendix A):** `ingest_msgs_total, ingest_parse_fail_total, ingest_frame_violations_total, ack_latency_ms (hist), stream_depth{shard}, pipeline_lag_ms (now−fix_time p95 gauge), pipeline_batch_rows (hist), ws_clients`.
**AC:** [ ] flood test drives `stream_depth` past 50k → paused-sockets metric >0, zero loss, drains · [ ] dashboard JSON committed & renders all metrics.
**Depends:** E02-3.

### E02-6 · Web shell: auth, device list, live map, PWA (M)
**Implements:** §5 web stack; V1-MUST live map; PWA.
**Files:** `apps/web/src/{main.tsx,routes/{login.tsx,app/map.tsx},components/{DeviceList.tsx,LiveMap.tsx},lib/{api.ts,ws.ts},i18n/{en,pl,lt,de}.json(skeleton)}`, `apps/web/{manifest.webmanifest,sw.ts}`.
**Approach:** MapLibre with `TILES_STYLE_URL`; visible "© OpenStreetMap contributors" attribution control (CLAUDE.md rule 13); marker layer fed by WS with cluster source; TanStack Router guards on auth.
**AC:** [ ] login → map with live markers from 500 simulated devices, no visible jank on founder laptop · [ ] OSM attribution visible on every map view · [ ] Lighthouse: installable PWA · [ ] tiles style swap via env (point at MapTiler URL) requires zero code change (manual check documented).
**Tests:** Playwright `tests/pw/smoke.spec.ts` (login→map→marker appears from simulator).
**NOT here:** history/trips UI, geofence editor.
**Depends:** E02-4; E03-1 (or its stub).

### E02-7 · Invalid-fix end-to-end (S)
**Implements:** I5.
**Files:** touches normalize.ts (flag), LiveMap trail rendering, rules stub guard.
**AC:** [ ] I5 unit test: invalid-fix record mutates neither trip-distance accumulator (stub hook) nor geofence evaluator input queue · [ ] invalidFix scenario renders a visible trail gap.
**Depends:** E02-3, E02-6.

### E02-8 · Real-world flood sign-off (S)
**Approach:** founder pulls SIM from driving FMB920 for 2 h, reinserts; verify.
**AC:** [ ] history complete & fix_time-ordered & dupe-free for the window · [ ] findings (any!) logged `docs/audit/real-flood-1.md` — an empty findings file is suspicious, look harder.
**Depends:** E02-3; E01-6.

---

## E03 — Tenancy & devices (W3) — *Epic exit: isolation suite CI-blocking green; two branded tenants on two domains.*

### E03-1 · Auth & RBAC (M)
**Files:** `apps/api/src/{auth/{login.ts,jwt.ts,middleware.ts}},packages/shared/src/roles.ts`, web login wiring.
**Approach:** argon2id (m=64MB,t=3,p=4), access JWT 15 min + rotating refresh (httpOnly cookie, family-invalidations on reuse), roles enum {platform_admin, tsp_admin, account_manager, viewer}; route guard middleware `requireRole(...)` + tenant/account claims in token.
**AC:** [ ] refresh-token reuse after rotation → whole family revoked (test) · [ ] role matrix table test: 4 roles × representative endpoints → expected 200/403 · [ ] argon2 params asserted in test (prevents silent weakening).
**Tests:** `apps/api/__tests__/auth.spec.ts`.
**NOT here:** password reset flows (post-v1, manual by admin).

### E03-2 · Scoped repositories + isolation suite (L; cut line: repo layer ‖ CRUD endpoints/UI)
**Implements:** §6.2; CLAUDE.md rule 2.
**Files:** `packages/db/src/repos/{tenants.ts,accounts.ts,users.ts,devices.ts,geofences.ts,rules.ts,events.ts,commands.ts,apiKeys.ts,webhooks.ts,audit.ts,index.ts}`, `packages/db/src/scope.ts` (`Scope = {tenantId: string; accountId?: string}` — every repo method's first arg), API CRUD routes + minimal admin UI pages, `tests/isolation/suite.spec.ts`.
**Approach:** repos are the ONLY export; each method appends scope predicates centrally (scope.ts helper builds Prisma `where`); audit repo wraps mutations. Isolation suite: fixtures 2 tenants × 2 accounts × users per role; iterates a route manifest (exported from api) hitting every endpoint cross-boundary expecting 403/404 — manifest-driven so NEW endpoints are auto-covered (unlisted endpoint → suite fails, forcing registration).
**AC:** [ ] Settings/Profile screen (locale, theme, password change) per DASHBOARD_UI_SPEC §4 · [ ] isolation suite green & CI-blocking · [ ] route added without manifest entry → suite fails (meta-test) · [ ] no file outside packages/db imports @prisma/client (lint proof committed as test).
**Depends:** E03-1, E01-3.

### E03-3 · Device management: CRUD, profiles, bulk import (M)
**Files:** repos/devices ext, `apps/api/src/routes/devices.ts`, `apps/web/src/routes/app/devices/*`, `packages/db/seed/profiles.ts`, import: `apps/api/src/routes/deviceImport.ts`.
**Approach:** profiles seeded (fmb1xx, fmc, fmb6xx-stub, tat-asset) with presence_rules & command_presets JSON; CSV import = upload → dry-run diff (create/update/error rows) → confirm → apply; registry sync (Redis `registry:imei`) on create/retire.
**AC:** [ ] 1,000-row CSV dry-run <10 s with per-row error report (bad IMEI checksum, dup, unknown profile) · [ ] retire device → ingest rejects next connect (0x00) within 5 s (registry propagation test).
**Edge cases:** IMEI with leading zeros preserved as string everywhere.
**Depends:** E03-2.

### E03-4 · Quarantine & claim flow (M)
**Files:** `apps/api/src/routes/quarantine.ts`, web page, ingest registry glue.
**Approach:** quarantine sorted-set (imei→last_seen, attempt count) surfaced per-tenant?? — **No: quarantine is PLATFORM-level** (unknown IMEIs have no tenant); platform_admin sees list; claim dialog assigns tenant+account+profile → device created → registry set → next connect accepted.
**AC:** [ ] e2e: unknown simulator IMEI connects (rejected) → appears in quarantine <5 s → claim → reconnect accepted → data flows · [ ] non-platform_admin cannot see quarantine (role test).
**Depends:** E03-3, E01-5.

### E03-5 · White-label: branding + custom domains (M)
**Files:** repos/tenants branding, `apps/api/src/routes/caddyAsk.ts`, `apps/web` theming provider (CSS vars from branding), email layout partials.
**Approach:** branding jsonb {logoUrl, primary, accent, productName, supportEmail}; Caddy on-demand TLS `ask` endpoint checks tenant_domains row (verified=true after DNS TXT check job) — rate-limited 10/min/IP; web reads branding by Host header via `/v1/branding` public endpoint.
**AC:** [ ] two demo tenants on two domains show distinct logo/colors/name (Playwright) · [ ] ask endpoint denies unknown domain (test) and is rate-limited · [ ] emails render tenant name+logo (snapshot test).
**Depends:** E03-2.

### E03-6 · Audit log (S)
**AC:** [ ] every repo mutation writes audit row (before/after diff, userId) — asserted by a repo-manifest meta-test like E03-2's · [ ] audit list UI (platform + tsp_admin scope).
**Depends:** E03-2.

---

## E04 — Trips & history (W4) — *Epic exit: real-drive distance ±5% vs manual log; playback approved by both founders.*

### E04-1 · Trip state machine (L; cut line: machine+persistence ‖ profile tuning/fixtures)
**Implements:** §6.4 verbatim; Appendix A `TripEngine`.
**Files:** `apps/worker/src/trips/{machine.ts,state.ts,persist.ts}`, `packages/shared/src/trips.ts`, fixtures `apps/worker/__fixtures__/drives/*.jsonl` (exported real captures via `tools/redact`).
**Approach:** pure-function machine `step(state, rec, profile) → {state', effects[]}` (effects: openTrip/closeTrip/updateIdle) — purity makes property tests trivial; state persisted per device in Redis hash + open trip row in DB (crash-safe: on start, reconcile open trips vs Redis). Only fix_valid records advance displacement; ignition-less profile branch per §6.4.
**AC:**
- [ ] real-drive fixture set: computed trips vs founder's manual log ±5% distance, ±2 min boundaries
- [ ] parking-jitter fixture (GPS drift, ignition off) → zero trips
- [ ] ferry/tow fixture (movement=1, ignition=0) → no trip under car profile; trip under asset profile
- [ ] idle accumulation test (ignition on, speed<3, 10 min) → idle_s ≈ 600±debounce
- [ ] worker restart mid-trip → trip continues, no duplicate open rows
**Tests:** `trips/__tests__/{machine.spec.ts,persist.spec.ts,property.spec.ts}` (property: record shuffle within same fix_times set post-sort ⇒ identical output).
**Depends:** E02-3.

### E04-2 · Late-batch trip recompute (M)
**Files:** `apps/worker/src/trips/recompute.ts` (BullMQ job), trigger in machine when rec.fix_time < lastClosedEnd.
**Approach:** job(device, window): SELECT positions ordered → delete trips overlapping window → replay machine → insert; idempotent; if window intersects compressed chunks and E01-3 verification said "needs decompress", call `decompress_chunk` first (guard by config flag set from that audit).
**AC:** [ ] property: any delivery order ⇒ identical trips table after recompute settles · [ ] recompute of a 24 h window <10 s at 30 s-interval density.
**Depends:** E04-1.

### E04-3 · History API + playback UI (M)
**Files:** `apps/api/src/routes/positions.ts`, `apps/web/src/routes/app/history/*` (timeline scrub, Recharts speed chart + **secondary series from attrs when present: fuel level, ext voltage — this IS the V1 fuel-graph feature**, stop markers, invalid-fix gaps as dashed segments).
**AC:** [ ] `/positions?from&to` cursor pagination ≤10k/page, stable ordering (fix_time, rec_hash) · [ ] 24 h @30 s track renders <2 s after data arrives (downsampling for >5k points: LTTB on client) · [ ] fuel series appears for a fixture device carrying LLS attrs and is absent otherwise (no empty chart).
**Depends:** E02-6, E02-3.

### E04-4 · Trips UI + reverse-geocoded endpoints (M)
**Files:** trips routes+pages; `packages/db/src/geocode.ts` (cache-first service: geohash7 key → hit | Photon reverse → upsert), used at render only.
**AC:** [ ] trip list + detail with route polyline & stats · [ ] second view of same trips serves ≥90% addresses from cache (counter test) · [ ] Photon down → UI shows coordinates, no error page (graceful degrade test).
**Depends:** E04-1, E01-2.

### E04-5 · Odometer preference (S)
**AC:** [ ] device-odometer default when AVL16 present & monotonic (non-monotonic → auto-fallback GPS + device flag surfaced) · [ ] report/trips show distance source label.
**Depends:** E04-1.

---

## E05 — Geofences, rules, notifications (W5) — *Epic exit: real geofence cross → Telegram <15 s; panic instant.*

### E05-1 · Geofence CRUD + editor (M)
**Files:** repos/geofences (PostGIS raw accessors: `ST_GeomFromGeoJSON`, area guard ≤ 10,000 km²), routes, `apps/web/.../geofences/*` with terra-draw (polygon, circle→buffered point stored as polygon).
**AC:** [ ] address search box (forward geocode via Photon `/api?q=`) recenters map for drawing · [ ] draw/edit/delete round-trips GeoJSON exactly · [ ] self-intersecting polygon rejected with useful error · [ ] per-account limit 500 geofences enforced.
**Depends:** E03-2, E02-6.

### E05-2 · Geometry cache + transition detection (M)
**Implements:** hysteresis rule.
**Files:** `apps/worker/src/rules/geofence.ts`, cache loader (Redis `geoms:{accountId}` versioned; invalidated by CRUD via pub/sub).
**Approach:** hot path point-in-polygon via turf on cached GeoJSON; state per (device,geofence) in Redis; ENTER after 2 consecutive fix_valid inside, EXIT after 2 outside; emits transitions to rules engine.
**AC:** [ ] boundary-jitter fixture (alternating in/out single fixes) → exactly one enter+exit pair · [ ] CRUD edit reflected in hot path <5 s (invalidation test) · [ ] 200 geofences × 1,500 rec/s stays <20% worker CPU (bench note in PR).
**Depends:** E05-1, E02-3.

### E05-3 · Rules engine + offline sweeper (L; cut line: evaluators ‖ sweeper+cooldowns)
**Implements:** §6.5; Appendix A `RuleEvaluator`.
**Files:** `apps/worker/src/rules/{engine.ts,evaluators/{overspeed.ts,ignition.ts,din.ts,powerCut.ts,lowBattery.ts,geofenceRule.ts},sweeper.ts}`.
**Approach:** engine consumes normalized records + geofence transitions; per-rule cooldown key `cd:{ruleId}:{deviceId}` SETEX 300; priority-2 record and power_cut evaluator bypass cooldown; every event inserted to `events` BEFORE notification enqueue (at-least-once notify, exactly-once event); sweeper (60 s tick) computes offline per profile presence_rules (car moving 5 min / TAT 26 h default) — emits device_offline + device_online recovery events.
**AC:** [ ] evaluator unit matrix (each kind: trigger, non-trigger, cooldown-suppressed, bypass where applicable) · [ ] power_cut = ext-voltage drop below threshold while battery present (profile flag) fires despite cooldown · [ ] TAT silent 20 h → NOT offline; 27 h → offline · [ ] event row exists even when notification channel is down (test).
**Depends:** E05-2, E04-1 (idle/trip context for future rules — soft), E02-3.

### E05-4 · Notification channels + events UI (M)
**Files:** `apps/worker/src/notify/{email.ts(SES),telegram.ts,dispatch.ts}` (BullMQ `notify` queue, backoff 1→2→4→8→16 min, max 5, DLQ), pairing endpoint `POST /v1/notify/telegram/pair` issuing deep-link token, bot webhook handler binding chat_id; events timeline UI with filters (kind, device, range).
**AC:** [ ] real car crosses real geofence → founder's Telegram <15 s (manual sign-off logged) · [ ] panic DIN on real device → TG instant · [ ] SES sandbox→prod verified sender; email snapshot shows tenant branding · [ ] pairing token single-use, 10 min TTL · [ ] channel outage → retries visible, DLQ after 5, event row intact.
**Depends:** E05-3, E00-4, E03-5 (branding partials).

---

## E06 — Reports & public API (W6) — *Epic exit: external script pulls yesterday's trips via API key; webhook HMAC-verified.*

### E06-1 · Report engine (L; cut line: trips/mileage/stops ‖ overspeed/geofence/engine-hours + TZ)
**Files:** `apps/worker/src/reports/{engine.ts,queries/*.sql,types.ts}`.
**Approach:** SQL-first (positions/trips/events; daily_device_stats cagg for mileage rollups); all computation UTC, rendering converts via account.timezone (date-fns-tz); engine returns typed rows (Appendix A `ReportRow<T>`); engine-hours = Σ ignition-on intervals from trips + idle.
**AC:** [ ] each of 6 report types has a fixture-backed correctness test · [ ] **DST test:** Europe/Warsaw 2026-10-25 day report = 25 h of wall-clock coverage, totals exact, no dup/missing hour · [ ] mileage report total ≡ Σ trips distance ±0.1% (reconciliation test) · [ ] 30-device month report <5 s (cagg proof).
**Depends:** E04-1,5; E05-3 (events).

### E06-2 · Export jobs (M)
**Files:** `apps/worker/src/reports/export.ts` (BullMQ), CSV writer, exceljs streaming XLSX, R2 upload + presigned URL (24 h), `POST /v1/reports/:type` + `GET /v1/reports/jobs/:id`.
**AC:** [ ] Reports UI page per DASHBOARD_UI_SPEC §4 (type cards, form, inline results, export buttons, last-10 history) · [ ] 100k-row XLSX streams under 512 MB RSS (memory test) · [ ] job status lifecycle queued→running→done|failed with error surface · [ ] URL expires (clock-skew test at 24 h+1 min).
**Depends:** E06-1.

### E06-3 · Public REST API v1 (M)
**Files:** `apps/api/src/{public/*,middleware/{apiKey.ts,rateLimit.ts}}`, OpenAPI page (Scalar) at `/docs`.
**Approach:** keys: `orb_live_` prefix, SHA-256 stored, scopes {read, commands, admin}; token bucket 600/min/key in Redis; every route zod-validated → OpenAPI generated; RFC7807 error shape everywhere (shared helper).
**AC:** [ ] the exact PROJECT_PLAN §6.6 route list exists & documented (route-manifest diff test) · [ ] rate limit returns 429 + Retry-After · [ ] revoked key → 401 <5 s (cache invalidation) · [ ] external demo script `examples/pull-trips.ts` committed and run in CI against seeded data.
**Depends:** E03-2, E04-3, E06-1.

### E06-4 · Webhooks (M)
**Files:** `apps/worker/src/notify/webhook.ts` (shares dispatch queue), CRUD routes, delivery-log UI.
**AC:** [ ] `X-Signature: sha256=hmac(body)` verified by test receiver · [ ] receiver 500s → backoff retries → DLQ after 5, delivery log shows attempts+bodies (truncated) · [ ] secret rotation: old secret honored 24 h (dual-sign header) — documented.
**Depends:** E06-3, E05-3.

### E06-5 · GDPR export & delete (S)
**AC:** [ ] `POST /v1/accounts/:id/export` → async zip (devices.csv, positions.csv chunked, events.csv, trips.csv) via export pipeline · [ ] device delete cascades (positions retained? **decision: positions deleted with device** — test proves no orphan rows) · [ ] tenant deletion runbook documented (manual, platform_admin).
**Depends:** E06-2.

---

## E07 — Ops, hardening, metering (W7) — *Epic exit: load gate passed; restore drill <30 min; 72 h soak green.*

### E07-1 · Alerting (M)
**Files:** `infra/grafana/alerts/*.yml` → Telegram contact point (founders' private chat).
**Rules:** stream_depth>30k 5 min; pipeline_lag_ms p95>60 s; parse_fail rate>1%; disk>80%; **Redis memory>75%**; cert expiry<14 d; Photon down 5 min; tiles URL probe (Kuma) failing 10 min; Postgres connections>80%.
**AC:** [ ] each rule test-fired once (silence window) with screenshot in PR.
**Depends:** E02-5, E01-2.

### E07-2 · Backups + restore drill (M)
**Files:** `infra/pgbackrest/*`, `docs/runbooks/restore.md`.
**AC:** [ ] nightly full + WAL archiving to offsite verified · [ ] **drill: scratch server, restore to point-in-time 10 min ago, app boots against it — RTO measured & <30 min, runbook followed literally by the founder who DIDN'T write it** · [ ] Redis explicitly documented as no-backup-by-design (runbook §).
**Depends:** E01-2.

### E07-3 · Load gate (M)
**Files:** `tools/replay/*`, `docs/audit/load-test.md`, ADR-006.
**Approach:** mix: 100 replayed real logs + simulators to 1,500 msg/s ×10 min against staging; measure p99 ACK, lag, CPU steal (if VDS), disk IOPS.
**AC:** [ ] p99 ack_latency <250 ms; zero loss (sent==stored); lag returns to <5 s within 2 min post-burst · [ ] ADR-006 decided (DB colocated vs separate; provider stays vs migrate) with numbers.
**Depends:** E02-*, E01-2.

### E07-4 · Metering + platform admin (M)
**AC:** [ ] usage_daily written from registry (active = ≥1 record that day) with backfill job · [ ] platform panel: tenants, devices, usage sparkline, ingest health · [ ] CSV export of monthly usage per tenant (invoicing input until Stripe).
**Depends:** E03-2, E02-3.

### E07-5 · Security pass (M)
**Checklist-driven:** CSP/headers (helmet-equivalent for Hono), dep audit + lockfile policy, gitleaks in CI, argon2 params re-check, WS-ticket review, API key timing-safe compare, quarantine flood behavior, Caddy ask rate limit, UFW final state, SSH hardening.
**AC:** [ ] `docs/audit/security-pass-1.md` with each item pass/fixed/ticketed — zero silent skips.

### E07-6 · Soak (S)
**AC:** [ ] 72 h: 5 real + 500 simulated; RSS growth <5%/24 h per service; zero unexplained gaps (gap-hunter script compares expected vs actual record counts per device) · [ ] findings doc (again: empty = look harder).
**Depends:** E02-*, E05-*.

---

## E08 — Pilot onboarding & polish (W8) — *Epic exit: first pilot connected with zero founder SSH.*

### E08-1 · Onboarding + legal pack (M)
**Files:** `docs/onboarding/{point-device.md(final),migrate-from-wialon.md,migrate-from-traccar.md}`, `legal/{tos.md,dpa.md,subprocessors.md,impressum.md,art30-register.md}`.
**AC:** [ ] point-device covers SMS/Codec12/FOTA per model incl. TAT100 quirks · [ ] ToS liability language reviewed by founder (lawyer review ticketed, not blocking pilot-free-tier) · [ ] subprocessors list matches actual (Hetzner/vpsnet as chosen, SES, R2, Telegram) · [ ] OSM attribution audit across all map views · [ ] **Impressum (TMG §5 — DE market requirement)** filled with real entity data · [ ] GDPR Art. 30 register [internal] started · [ ] external pentest ticketed post-revenue.
### E08-2 · Codec 12 command UI + backend (M)
**Files:** `apps/api/src/routes/commands.ts`, `apps/worker/src/commands/dispatcher.ts` (consumes `commands` table queue → writes to live socket via ingest control channel `cmd:send:{deviceId}` Redis pub/sub → ingest session encodes Codec12 → response from `cmd:resp:{deviceId}` correlated FIFO → status update), web UI with presets (§8 W8 list) + raw, deleterecords double-confirm modal.
**AC:** [ ] getinfo round-trip on REAL device shown in UI <10 s · [ ] device offline → queued, sent on reconnect, expired after 24 h (state machine test) · [ ] response FIFO correlation test with two queued commands · [ ] viewer role cannot send (RBAC).
**Depends:** E01-5 (resp capture), E03-3.
### E08-3 · i18n EN/PL/LT/DE (M)
**AC:** [ ] no hardcoded strings (lint rule i18next/no-literal-string on jsx) · [ ] PL reviewed by native speaker, review noted in PR · [ ] date/number formatting per locale (Intl) incl. report exports.
**Depends:** E02-6.
### E08-4 · Seed-demo tool (S)
**AC:** [ ] `pnpm seed:demo` builds demo tenant with 12-vehicle fleet + 7 days synthetic history (simulator offline-mode writing via pipeline) — runnable on prod safely (isolated tenant).
**Depends:** E02-2.
### E08-5 · Pilot enablement (S)
**AC:** [ ] shadow-mode checklist doc · [ ] 2 pilot tenants created with branding · [ ] public status page live · [ ] founder-blind test: the OTHER founder onboards a device using docs only, zero SSH.
### E08-6 · Buffer / dogfood fixes (M reserved)
Intentionally unplanned. If untouched by W8-Wed, pull V1-NICE items in this order: device-health view → share links → PDF export.

---

## E09 — Affiliate module & public-site glue (W9; PROJECT_PLAN §6.9)

### E09-1 · Schema + attribution capture (M)
**Files:** prisma (affiliates, commission_entries, tenants.referred_by_affiliate_id), repos/affiliates.ts, `apps/api/src/routes/public/pilotRequest.ts` (unauth, rate-limit 5/min/IP, honeypot field), leads table or reuse audit? → dedicated `pilot_leads` table.
**AC:** [ ] pilot-request stores lead incl. ref code (invalid code → lead stored, ref null, flagged) · [ ] tenant-create flow can bind referred_by once; second write attempt → 409 + audit row (immutability test) · [ ] self-referral guard test (email-domain match blocked).
**Depends:** E03-2.
### E09-2 · Commission engine (M)
**Files:** `apps/worker/src/affiliate/monthClose.ts` (BullMQ cron, 1st of month), pricing map shared const.
**AC:** [ ] entries created per referred tenant with collected-revenue base from usage_daily × plan (fixture math test, incl. proration month) · [ ] maturation: entries auto pending→approved at +30 d job · [ ] clawback reverses amount via compensating entry, never mutates original (ledger integrity test) · [ ] rerun of month-close is idempotent (unique (affiliate,tenant,period)).
**Depends:** E09-1, E07-4.
### E09-3 · Platform admin UI + statements (S)
**AC:** [ ] Affiliates screen per DASHBOARD_UI_SPEC §4 (CRUD, rate override, ledger chips, status transitions RBAC platform_admin) · [ ] monthly statement CSV per affiliate (entries, totals) matches ledger sum (reconciliation test).
**Depends:** E09-2.
### E09-4 · Public site integration (S)
**AC:** [ ] apps/site (Lovable export) builds in CI, deployed via Caddy · [ ] ?ref cookie → form payload verified e2e (Playwright on site) · [ ] pilot-request end-to-end: site → API → lead visible in platform panel.
**Depends:** E09-1; PUBLIC_WEB_LOVABLE.md export done (human).

---

## Appendix A — Interface contracts (frozen; changes require ADR)
```ts
// packages/codec
export interface TeltonikaCodec {
  feed(chunk: Buffer): Frame[];                 // streaming framer, per-connection instance
  parse(frame: Frame): ParsedPacket;            // throws CrcError | FrameError
  encodeAck(count: number): Buffer;
  encodeImeiReply(accept: boolean): Buffer;
  encodeCodec12(cmd: string): Buffer;
  decodeCodec12(frame: Frame): string;
}
export type ParsedPacket =        // extended per docs/adr/013 (additive fields only)
  | { kind: 'imei'; imei: string }
  | { kind: 'avl'; codec: 8|0x8e|16; records: AvlRecord[]; rawFallback?: boolean }
  | { kind: 'cmdResponse'; codec: 12|13|14; text: string; nack?: boolean };
export interface AvlRecord { tsMs: number; priority: 0|1|2; lat: number; lon: number;
  altitude: number; angle: number; satellites: number; speed: number;
  eventIoId: number; io: Map<number, bigint|Buffer>; raw: Buffer }

// packages/shared
export interface NormalizedRecord { deviceId: bigint; fixTime: Date; serverTime: Date;
  lat: number; lon: number; altitude: number|null; speed: number|null; course: number|null;
  satellites: number; fixValid: boolean; ignition: boolean|null; movement: boolean|null;
  odometerM: bigint|null; priority: 0|1|2; recHash: bigint; attrs: Record<string, unknown> }

// worker trip engine (pure)
export type TripEffect = {t:'open'|'close'|'idle'|'recompute'; ...};
export function tripStep(s: TripState, r: NormalizedRecord, p: PresenceRules):
  { state: TripState; effects: TripEffect[] };

// rules
export interface RuleEvaluator { kind: RuleKind;
  evaluate(r: NormalizedRecord, ctx: RuleCtx): EventDraft[] }

// db scope — first arg of EVERY repo method
export type Scope = { tenantId: string; accountId?: string };

// metric names are API — see E02-5 list; renaming = ADR.
```

## Appendix B — Repo tree (target end-state, abbreviated)
`apps/{ingest,worker,api,web}` · `packages/{codec,db,shared}` · `tools/{simulator,replay,redact,seed-demo}` · `infra/{ansible,compose,caddy,grafana,prometheus,pgbackrest}` · `docs/{adr,epics,audit,onboarding,runbooks}` · `legal/` · `tests/{e2e,isolation,pw}` · `.claude/{agents,commands,settings.json}`.

## Appendix C — V1-MUST coverage matrix
live map E02-6 · playback+speed+fuel-graph E04-3 · trips/stops/idle E04-1 · geofences E05-1 · rules E05-3 · email/TG E05-4 · reports E06-1 · CSV/XLSX E06-2 · tenancy+RBAC E03-1,2 · white-label+domains E03-5 · device mgmt/import/quarantine/profiles E03-3,4 · commands E08-2 · REST+keys E06-3 · webhooks E06-4 · metering E07-4 · PWA E02-6 · i18n E08-3 · GDPR E06-5 · events set (panic E02-2/E05-3, power_cut/offline/din/ignition/overspeed/low_battery/geofence E05-3) · audit_log E03-6 · affiliate attribution/ledger/statement E09-1..3 · public site + pilot form E09-4 · settings/profile E03-2 · reports UI E06-2.

## Appendix D — Parallelization map (max 2–3 lanes; per CC_PLAYBOOK)
E01-2 ∥ E01-4 · E02-1 → then E01-5 ∥ E02-2 · E02-5 ∥ E02-6 · E03-3 ∥ E03-5 · E04-1 ∥ E04-3(against Appendix A contract) · E05-1 ∥ E05-3(stub transitions) · E06-2 ∥ E06-3 · E08-2 ∥ E08-3.
**Serial-only:** packages/codec fixtures, packages/db/sql migrations, Appendix A edits.

## Appendix E — Backlog audit log (v2, 5 fresh rounds)
- **R1 Coverage & invariants:** matrix (App. C) re-traced against PROJECT_PLAN §4 — complete. Invariants mapped to named tests: I1/I2/I3 → E02-3 AC, I4 → E02-5 AC, I5 → E02-7 AC. Gap found & fixed during the pass: `device_online` recovery event existed nowhere → added to E05-3 sweeper.
- **R2 Dependency DAG walk:** three real ordering bugs fixed while drafting: (a) E01-5 tests need simulator → build order flipped (E02-1 first, stated in both stories); (b) E02-4/E02-6 need login before E03-1 → explicit stub-then-remove protocol written into both; (c) E05-4 email branding needs E03-5 partials → dependency added. Command send path (E08-2) verified to need only the resp-capture half of E01-5, which E01-5 delivers.
- **R3 AC executability sweep:** every checkbox is machine- or ritual-verifiable; the two unavoidably human ACs (playback UX approval, Telegram <15 s live test) are explicitly labeled manual sign-offs with logging requirement. Weasel-word grep across all stories: zero occurrences outside this sentence's own quoted list.
- **R4 Contract consistency:** Appendix A types cross-checked against every story referencing them; found & fixed: E02-3 originally emitted records unsorted to trip engine while E04-1 assumed sorted — sorting responsibility pinned to E02-3 (stated in both); `Scope` as first-arg rule now stated identically in E03-2 and Appendix A; metric names list single-sourced (E02-5 ↔ Appendix A pointer).
- **R5 Skeptical capacity audit (the uncomfortable one — corrected by mechanical count after drafting):** first draft of this very audit claimed 6 L + 24 M ≈ 40.5 d; grep count says **7 L + 29 M + 9 S = 47.5 focused dev-days** (+1 d E08-6 reserve). Apply reality tax: CC-assisted work still costs review/plan-approval/rework (×1.3) → ~62 d; add real-device debugging tail (E02-8/E04-1/E08-2, historically +4–6 d) → **~66–68 d needed vs ~56 realistically available** (2 founders × 8 wks × 70% allocation). **Honest conclusion: E01–E08 in 8 calendar weeks is NOT realistic at 70% allocation — the plan as written is a ~10-week plan, or an 8-week plan with descopes pre-committed.** Options, pick before W1 (not during a panic in W6): (A) accept 10 weeks — pilots start W10, still fine vs market; (B) 8 weeks by pre-cutting: custom domains → W9, DE locale → W9, webhook delivery-log UI → W9 (API stays), PDF/scheduled reports never were in; (C) raise allocation ≥85% for the window. What does NOT get cut under any option: invariant tests, isolation suite, restore drill, load gate — cutting verification to save time is how this exact plan dies in month 3. This finding supersedes the earlier "zero slack" phrasing; the arithmetic error itself is left documented here as proof the audits bite their author too. **R5 addendum (post-E09):** affiliate epic adds 2 M + 2 S ≈ 3 d in W9 — outside the 8-week window by design, but it consumes the W9 slack that Option A relied on; Option A remains correct, with W9 = pilots + E09, W10 = hardening buffer.
