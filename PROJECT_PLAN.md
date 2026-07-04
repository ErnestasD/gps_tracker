# PROJECT PLAN v2.0 — Teltonika-First White-Label GPS Tracking Platform
**Codename:** TrackCore · **Status:** post 5-round audit, hand-off ready
**Audience:** founders + Claude Code (read together with repo-root `CLAUDE.md`)
**Date:** 2026-07-03

---

## 1. Mission & Product Definition

Multi-tenant, white-label GPS tracking platform, **Teltonika devices only in v1**, positioned between gps-server.net (cheap/dated) and GpsGate (advanced/expensive). Primary customer: **TSP/reseller** managing sub-clients. Secondary: mid-size fleets (20–200 vehicles).

Strategic pillars: (1) Teltonika-native depth instead of 800-device mediocrity; (2) TSP hierarchy + white-label as core architecture, not bolt-on; (3) modern UX; (4) EU data residency (Hetzner DE) as GDPR/DSGVO sales asset; (5) transparent per-device pricing €1.5–2.5/device/mo.

Out of scope v1 (hard line): fuel-theft detection (graph display only), deep CAN decode, tachograph DDD, video, native mobile apps (PWA only), driver scoring, maintenance module, route optimization, UDP transport (nice-to-have), corridor geofences.

Timeline: **8 weeks → pilot-ready v1** (2 devs + Claude Code), weeks 9–16 shadow-mode pilots + hardening, first paid ~month 4–5.

---

## 2. Verified Reference Library (single source of truth for CC)

**Teltonika protocol & hardware — wiki.teltonika-gps.com (authoritative; EN):**
- Codec spec (ALL codecs, handshake, CRC, examples): https://wiki.teltonika-gps.com/view/Codec  ← the bible; every byte-level decision cites this
- Data sending protocols overview (TCP/UDP flow): https://wiki.teltonika-gps.com/view/Teltonika_Data_Sending_Protocols
- FMB120 AVL ID table (template for FMB1xx family): https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
- Per-model pages follow pattern `…/view/<MODEL>` and `…/view/<MODEL>_Teltonika_Data_Sending_Parameters_ID` (e.g. FMB920, FMC130, FMB640, TAT100). FMM/FMC share the FMB template: https://wiki.teltonika-gps.com/view/Template:FMB_AVL_ID_FMM_FMC
- FMB SMS/GPRS command set (Codec 12 payloads): https://wiki.teltonika-gps.com/view/FMB_getinfo and sibling pages under `FMB_Commands`
- FOTA WEB (device config cloud, has API — v2 integration): https://wiki.teltonika-gps.com/view/FOTA_WEB

**Parser candidates (wrap, don't trust blindly):**
- npm `complete-teltonika-parser` (TS, TCP+UDP, IMEI helper): https://github.com/TimeLord2010/TeltonikaParser
- npm `teltonika-codec-parser` (Codec 8/8E/16, tests built from official wiki examples): https://libraries.io/npm/teltonika-codec-parser
- Go reference (58M real packets tested — edge-case oracle #2): https://github.com/filipkroca/teltonikaparser
- **Edge-case oracle #1:** Traccar `TeltonikaProtocolDecoder` (Apache 2.0): https://github.com/traccar/traccar → `src/main/java/org/traccar/protocol/TeltonikaProtocolDecoder.java`

**Platform components:**
- Traccar backend (Apache 2.0 — fallback Plan B + reference): https://github.com/traccar/traccar ; modern web (Apache 2.0, MapLibre-based): https://github.com/traccar/traccar-web
- **Golden-corpus source #2:** Traccar decoder tests contain real captured hex packets — harvest with attribution (Apache 2.0): `src/test/java/org/traccar/protocol/TeltonikaProtocolDecoderTest.java`
- **Go codec lib with ENCODE support (Codec 8/8E/16/12/13/14 TCP+UDP)** — ideal engine for our simulator's packet generation + reference oracle #3 (verify repo license in W1): https://github.com/alim-zanibekov/teltonika
- Telemify (hosted Teltonika emulator: routes, event injection, CAN frames) — complementary for demos/manual QA, NOT for CI (CI stays on our deterministic tools/simulator): https://telemify.io
- MapLibre GL JS: https://maplibre.org · **Tiles: OpenFreeMap — free public instance, no API keys, no view limits, OpenMapTiles schema, self-host scripts published (Hetzner+nginx+Btrfs, ~300 GB SSD / 4 GB RAM using prebuilt images):** https://openfreemap.org + https://github.com/hyperknot/openfreemap · commercial fallback if ever needed: MapTiler
- Geofence drawing: terra-draw (MIT, MapLibre-native): https://github.com/JamesLMilner/terra-draw
- **Reverse geocoding: Photon (Apache 2.0, komoot)** self-hosted via docker with GraphHopper **prebuilt country extracts** (PL/DE/LT/LV/EE — small, weekly-updated dumps; no Nominatim import needed): https://github.com/komoot/photon + https://github.com/rtuszik/photon-docker + dumps at https://download1.graphhopper.com/public
- TimescaleDB: https://github.com/timescale/timescaledb · License terms: https://www.tigerdata.com/legal/licenses · Editions: https://www.tigerdata.com/docs/about/latest/timescaledb-editions
- PostGIS: https://postgis.net · BullMQ: https://docs.bullmq.io · Hono: https://hono.dev · zod-openapi: https://github.com/honojs/middleware/tree/main/packages/zod-openapi
- Prisma: https://www.prisma.io/docs · i18next: https://www.i18next.com · XLSX export: exceljs (streaming writer for large reports) · Error tracking: GlitchTip self-host (Sentry-SDK compatible): https://glitchtip.com · Status page: Uptime Kuma

**License verdicts (audited):** Traccar backend+modern-web Apache 2.0 (commercial use/modification OK). Parser npm libs ISC/MIT-class. MapLibre BSD. **TimescaleDB: use Community Edition under TSL — free for self-hosted production including compression & continuous aggregates; the only prohibition is offering TimescaleDB itself as a database service, which we don't. Refer to it as "TimescaleDB Community Edition" in docs (license §2.4 naming requirement).**

---

## 3. Protocol Specification (verified against wiki /view/Codec — treat as normative)

### 3.1 Codec IDs
`0x08` Codec 8 · `0x8E` Codec 8E · `0x10` Codec 16 (parse→raw fallback) · `0x0C` Codec 12 (GPRS cmds) · `0x0D` Codec 13 · `0x0E` Codec 14. All multi-byte integers **big-endian**.

### 3.2 TCP session (data direction)
1. Device connects, sends `0x000F` (2-byte IMEI length) + 15 ASCII IMEI bytes. Example: `000F333536333037303432343431303133` = IMEI 356307042441013.
2. Server replies **1 byte**: `0x01` accept / `0x00` reject (unknown IMEI ⇒ reject, log to quarantine).
3. Device streams AVL packets. Per packet, server replies **4-byte BE count of accepted records**. Count mismatch ⇒ device resends the packet. **⇒ ACK is our loss-prevention contract: send count only after durable persistence; on parse/CRC failure send count of good records actually persisted (0 if whole packet bad) — the device becomes our replay buffer.**

### 3.3 AVL packet structure
`[4B preamble 0x00000000][4B Data Field Length][1B CodecID][1B NumberOfData1][AVL records…][1B NumberOfData2][4B CRC-16]`
- Data Field Length counts CodecID→NumberOfData2. CRC-16/IBM computed over the same span. NumberOfData1 MUST equal NumberOfData2 (validate).
- Size limits: max packet **1280 B** (FMB630/640/FM63XY: **512 B**, min record 45 B) ⇒ framing buffer per socket 4 KiB is generous; anything claiming length > 4096 ⇒ protocol error, close socket, log.

### 3.4 AVL record
`[8B timestamp ms since Unix epoch][1B priority][GPS 15B][IO element]`
- **Priority: 0 Low, 1 High, 2 PANIC** ⇒ priority=2 raises an immediate `panic` event bypassing rule engine cooldowns.
- GPS element: `[4B lon][4B lat][2B alt][2B angle][1B satellites][2B speed]`. Lat/lon = signed two's-complement int of degrees×1e7 (first bit 1 ⇒ negative). Speed km/h.
- **Invalid-fix rule (wiki-verified, was missing in v1 plan):** when no GPS fix at acquisition, device sends **last valid lat/lon/alt with angle=0, satellites=0, speed=0**. ⇒ `fix_valid := satellites > 0`. Invalid-fix records: store (attrs intact), **exclude from**: trip distance accumulation, geofence evaluation, overspeed, map trail (render as gap); allowed for: "device alive" presence, IO-based events (ignition/DIN/panic).
- IO element (Codec 8): `[1B EventIOID][1B N total][N1 count + (1B id,1B val)…][N2 + (1B id,2B val)…][N4…][N8…]`. **Codec 8E:** identical concept but **2-byte IO IDs, 2-byte counts, and an extra NX group of variable-length elements (2B id + 2B length + data)** — this is what carries BLE/EYE payloads. EventIOID names which AVL triggered an eventual record (0 = periodic).

### 3.5 Codec 12 (commands)
Request/response text commands over the same socket (`getinfo`, `getver`, `setparam <id>:<val>`, `cpureset`, `dout` control…). Structure mirrors data packets with CodecID 0x0C, command/response as length-prefixed ASCII. Implementation: per-device command queue; send only when socket live; correlate response by socket order (device answers sequentially); timeout 30 s ⇒ `failed`, retry policy max 3, expire after 24 h. Full command payloads: FMB Commands wiki pages (link §2).

### 3.6 Buffered/out-of-order reality
On GSM loss devices batch-store and flood on reconnect **with original timestamps**, oldest-first, potentially hundreds of records across consecutive packets. Consequences (architecture-normative): per-device time-ordered processing (§6.2), latest-position = max(fix_time), bounded recompute for late batches hitting closed trips (§6.5), timestamp sanity window (reject fix_time > now+48 h or < 2020-01-01 → `raw_rejects`).

### 3.7 Verified core AVL IDs (FMB1xx family; provenance: wiki FMB120 table + Codec page examples)
| ID | Name | Notes |
|---|---|---|
| 1 | DIN1 | digital input |
| 21 | GSM signal | 0–5 |
| 66 | External voltage | mV |
| 67 | Battery voltage | mV |
| 69 | GNSS status | 1 = ON w/ fix, 2 = ON w/o fix, 3 = sleep |
| 78 | iButton | 8 B |
| 80 | Data mode | home/roaming × stop/moving |
| 200 | Sleep mode | 0–4 (4 = Ultra) |
| 16 / 199 | Total / trip odometer | m |
| 239 | Ignition | 0/1 |
| 240 | Movement | 0/1 |
| 241 | Active GSM operator | MCC+MNC |
| 246 | Towing | event |
| 253 | Green driving type | 1 acc / 2 brake / 3 corner |
| 269 / 270 | Escort LLS #1 temp / fuel | **FMB125-class RS485 accessory — family-specific!** |
| 385 | BLE beacon list | variable (8E NX group) |

**Dictionary rule (unchanged, now proven necessary):** LLS/CAN/DOUT/analog and the whole FMB640 pro range differ per family ⇒ W1 story generates per-family JSON dictionaries **from the wiki tables**, committed under `packages/codec/dictionaries/<family>.json` with `"source_url"` + `"retrieved_at"` fields. Runtime never contains hardcoded IDs outside these files. Unknown IDs are stored as `io_<id>` in `attrs` — never dropped, never guessed.

---

## 4. Feature Scope (contract — CC must not exceed without ADR)

**V1 MUST:** live map w/ clustering + device status · history playback + speed chart · trips/stops/idling · geofences (polygon/circle) + enter/exit/speed rules · notifications email + Telegram · reports (trips, mileage, stops, overspeed, geofence, engine-hours) with CSV/XLSX export · multi-tenant hierarchy Platform→TSP→Account→User · white-label (logo/colors/name/custom domain) · RBAC · device mgmt (bulk CSV import, quarantine/claim, profiles) · Codec 12 commands (raw + 10 presets) · fuel level **graph** (where AVL present) · public REST API + API keys + HMAC webhooks · usage metering (device-days) · PWA · i18n EN/PL/LT/DE · GDPR (retention config, device-delete cascade, export) · `power_cut`, `device_offline`, `panic`, `low_battery`, `din_change`, `ignition`, `overspeed(static)`, `geofence` events.
**V1 NICE (only if week has slack):** **device-health view** (per-device GSM signal, ext/battery voltage trend, last FW string from getver, last-seen — the #1 TSP support-call deflector) · UDP listener · PDF report export · scheduled emailed reports · web-push · temporary share links · EYE temperature display · driver registry (iButton) · Stripe metered billing.
**V2:** fuel theft detection (needs ≥8 wks stored LLS data) · CAN deep decode · corridor geofences · OSM road-speed overspeed · EYE full pairing · FOTA WEB integration · native apps · driver scoring · maintenance · custom SMTP/DKIM per tenant.
**V3+:** tachograph DDD · video (DualCam) · route optimization (OSRM) · marketplace integrations.

---

## 5. Tech Stack (final, audited)

TypeScript everywhere, Node 22 LTS, pnpm workspaces + Turborepo.
`apps/ingest` (raw TCP, zero business logic) · `apps/worker` (pipeline consumers + BullMQ jobs) · `apps/api` (Hono REST + WS gateway) · `apps/web` (React 18 + Vite SPA) · `packages/codec` (parser wrapper, dictionaries, golden tests) · `packages/db` (Prisma relational + raw SQL/Timescale layer + scoped repositories) · `packages/shared` (zod schemas = single type source) · `tools/simulator` (device emulator) · `tools/replay` (pcap/log replayer) · `tools/redact` (strips real IMEIs from captures before they become fixtures).

**Data:** PostgreSQL 16 + TimescaleDB Community + PostGIS, one instance. Prisma owns relational tables; **positions hypertable is raw-SQL territory (Prisma forbidden there)** — inserts via `pg` batched multi-row INSERT…ON CONFLICT (see §6.1; COPY only via ADR-008 staging pattern), migrations via numbered SQL files `packages/db/sql/NNN_*.sql` applied by a tiny migrator script.
**Queue split (fixes v1-plan ambiguity):** **Redis Streams** = the ordered raw pipeline (`raw:{0..15}`, consumer group `pipeline`, shard = IMEI % 16, **`MAXLEN ~ 100_000` per shard** — worst-case buffer ≈ 3–4 GB RAM total, ≈9 min of 1,500 msg/s with consumers down before backpressure). **BullMQ** = everything async and unordered: notifications, report generation, exports, trip-recompute jobs, webhook delivery w/ retries. Redis 7, AOF `everysec`, **`maxmemory-policy noeviction` (BullMQ hard requirement — any eviction policy silently corrupts queues) + maxmemory alert at 75%**. **Redis backup posture: none needed by design** — streams hold only in-flight data (unACKed batches are re-sent by devices; ACKed-but-unprocessed survive via AOF), live-state hashes rebuild from positions on worker start. Document this in the runbook so nobody adds pointless Redis dumps.
**Realtime:** Redis pub/sub `live:{tenant}` → WS in `apps/api` (auth via **single-use ws-ticket, TTL 30 s**; never raw JWT in query strings).
**Maps (free stack, deliberate):** MapLibre GL + **OpenFreeMap public instance** (style URL, no key, no limits) as default; resilience path documented = self-host OpenFreeMap prebuilt image on a dedicated box (~300 GB SSD/4 GB RAM) or PMTiles behind Caddy; MapTiler only as paid emergency fallback (style URL is an env var — switching = config change, zero code).
**Reverse geocoding (free stack):** **self-hosted Photon** container with GraphHopper country extracts (PL+DE+LT+LV+EE at launch; add countries as tenants demand) + geohash7 cache table (§6.3) — komoot's public instance is dev-only fair-use, never production. Marginal cost €0; disk ≈ tens of GB for our countries.
**Web:** MapLibre GL, terra-draw (geofence editor), TanStack Query+Router, Tailwind + shadcn/ui, i18next, Recharts for speed/fuel charts.
**Infra:** Hetzner Falkenstein — v1: 1× AX42 (app+redis+workers) + 1× dedicated volume-backed Postgres box (or same host container, ADR-006 decides on load test). Docker Compose, GitHub Actions CD, Caddy (auto-TLS incl. tenant custom domains via on-demand TLS). Backups: pgBackRest → Hetzner Storage Box, nightly full + WAL; **restore drill W7 exit criterion**. Observability: Prometheus + Grafana + Loki, node/postgres/redis exporters, custom metrics (`ingest_msgs_total`, `ingest_parse_fail_total`, `ack_latency_ms`, `stream_depth`, `pipeline_lag_ms`, `ws_clients`); Uptime Kuma public status page; GlitchTip (Sentry-compatible SDKs) both back and front.
**Error tracking:** GlitchTip self-hosted (Sentry-SDK compatible; swap to Sentry SaaS only if ops burden proves real).
**Monthly cost model (free-first mandate — every paid line needs a free alternative named):**
| Component | Choice | €/mo |
|---|---|---|
| Compute (prod) | Hetzner AX42 | ~52 |
| Staging | Hetzner CPX31 cloud | ~14 |
| Backups | Hetzner Storage Box 1 TB | ~4 |
| Map tiles | OpenFreeMap public (fallback: self-host/MapTiler) | 0 |
| Geocoding | Photon self-host (country extracts) | 0 |
| Maps/geo licenses | MapLibre/terra-draw/PostGIS/OSM (attribution required: "© OpenStreetMap contributors") | 0 |
| Error tracking / status / monitoring | GlitchTip + Uptime Kuma + Prometheus/Grafana/Loki self-host | 0 |
| Email | AWS SES eu-central-1 (~€0.10/1k) or Postmark if deliverability pain | ~1–15 |
| Telegram | Bot API | 0 |
| Object storage (exports) | Cloudflare R2 free tier (10 GB) | 0 |
| Domain + misc | | ~3 |
| **Total** | | **~€75–90** |

**Ingest port:** 5027 TCP (industry convention for Teltonika — matches Traccar default, eases migrations toward us).
**Performance envelope:** design/verify 5,000 devices @30 s ≈ 167 msg/s sustained; **load-test gate: 1,500 msg/s for 10 min, p99 ACK < 250 ms, zero loss** (reconnect-storm model). Storage: ~5.3 B rows/yr @5 k devices ⇒ Timescale compression (target ≥85%) + continuous aggregates for reports; retention default 12 mo raw (tenant-configurable), aggregates kept.

---

## 6. Architecture (normative)

### 6.1 Pipeline
```
TCP socket (SO_KEEPALIVE on; per-IP conn cap 200; handshake timeout 10 s; read-idle timeout per device profile)
→ framing (length-prefix, 4 KiB cap) → IMEI handshake (Redis device registry, unknown⇒0x00+quarantine log)
→ CRC-16 verify → codec parse → per-record sanity (timestamp window, coord range, fix_valid flag)
→ XADD raw:{imei%16} → reply 4B accepted-count → THEN check shard depth → maybe socket.pause()
Consumers (worker; exclusive shard ownership; XAUTOCLAIM min-idle 60 s on start + every 30 s to recover a crashed peer's pending entries):
  normalize → **batched multi-row INSERT … ON CONFLICT DO NOTHING** into positions
  (500-row batches ≈ 3 batches/s at burst target — ample; NOTE: PostgreSQL COPY does NOT support ON CONFLICT,
   so COPY is only a future optimization via UNLOGGED staging table + INSERT…SELECT, ADR-008 if ever needed)
  → update Redis live hash device:{id} (+publish live:{tenant})
  → evaluate rules (geofence transitions via cached prepared geoms, overspeed, ignition, DIN, power_cut, panic-priority)
  → trip state machine feed → events insert → BullMQ enqueue (notify/webhook)
```
Invariants (each is an automated test): **I1** ACK count == records durably in stream. **I2** per-device processing strictly ordered by fix_time (shard exclusivity + XAUTOCLAIM single-claimer). **I3** re-delivered batch ⇒ zero duplicate positions (`ON CONFLICT (device_id, fix_time, rec_hash) DO NOTHING`; rec_hash = xxhash64 of raw record bytes, stored as SIGNED bigint via two's-complement reinterpretation — xxhash64 is unsigned 64-bit and values >2^63-1 must not be passed as unsigned strings). **I4** shard depth > **50k** ⇒ ingest pauses reads on sockets feeding that shard (backpressure; devices buffer by design) + alert. **I5** invalid-fix records never mutate trip distance/geofence state.

**Deploy/shutdown protocol (ops-normative):** SIGTERM → ingest stops accepting, finishes in-flight parse→XADD→ACK per socket (10 s grace), closes; workers finish current batch, XACK, release shard leases. Devices reconnect and re-send unACKed data by design — a deploy must never create an un-ACKed-but-persisted or ACKed-but-lost window. Auth endpoints: progressive lockout (5 fails → 15 min per IP+email).

**Device-auth honesty note (security posture):** device identity is IMEI-only — spoofable, and this is the entire industry's v1 reality (Wialon/Traccar/GpsGate default mode is identical). Accepted for v1 with mitigations: per-IP caps, handshake rate-limit, quarantine for unknown IMEIs, audit trail. V2 hardening: optional TLS ingest listener (FMB/FMC firmware supports TLS) and physics-based teleport filter flagging impossible jumps. Do not present v1 as tamper-proof to security-sensitive prospects.

### 6.2 Multi-tenancy & white-label
Hierarchy tables + `tenant_id`/`account_id` on every row. **All DB access via `packages/db` scoped repositories — raw Prisma client is not exported; ESLint rule bans `@prisma/client` imports outside packages/db.** Cross-tenant isolation test suite (fixtures: 2 tenants × 2 accounts; every API endpoint asserted 404/403 across boundary) runs in CI from W3 forever. White-label: `tenants.branding` jsonb + `tenant_domains` (Caddy on-demand TLS ask endpoint validates domain ownership). Email display-name per tenant on shared sending domain (custom DKIM = V2).

### 6.3 Data model — key DDL (positions; relational tables via Prisma mirror §5.3 of v1 plan: tenants, accounts, users, device_profiles, devices, raw_rejects, trips, geofences(geography), rules, events, commands, api_keys, webhooks, usage_daily, audit_log, geocode_cache)
```sql
CREATE TABLE positions (
  device_id   bigint       NOT NULL,
  fix_time    timestamptz  NOT NULL,
  server_time timestamptz  NOT NULL DEFAULT now(),
  lat double precision NOT NULL, lon double precision NOT NULL,
  altitude smallint, speed smallint, course smallint,
  satellites smallint, fix_valid boolean NOT NULL,
  ignition boolean, movement boolean,
  odometer_m bigint, priority smallint NOT NULL DEFAULT 0,
  rec_hash bigint NOT NULL,
  attrs jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (device_id, fix_time, rec_hash)
);
SELECT create_hypertable('positions','fix_time', chunk_time_interval => interval '1 day');
-- course column stores the protocol's "Angle" field (name normalized; document in codec mapper)
ALTER TABLE positions SET (timescaledb.compress,
  timescaledb.compress_segmentby='device_id', timescaledb.compress_orderby='fix_time');
SELECT add_compression_policy('positions', compress_after => interval '14 days');
-- 14d (not 7d): buffered floods from devices offline >compress_after would insert into COMPRESSED
-- chunks; support for that + unique-constraint enforcement is TimescaleDB-version-dependent.
-- W1 verification task: prove insert-into-compressed works with our PK on the pinned TS version;
-- recompute path may decompress_chunk() as fallback. (Audit R8-2)
SELECT add_retention_policy('positions', drop_after => interval '13 months');
-- Retention is PLATFORM-WIDE by design: chunks are time-partitioned across ALL tenants, so
-- per-tenant retention cannot drop chunks. One global raw-retention (13 mo) with cheap chunk
-- drops; tenants may configure SHORTER retention (delete-by-device job, V2) but never longer
-- than platform max without a custom plan that raises the global value. (ADR-007, Audit R8-3)
CREATE MATERIALIZED VIEW daily_device_stats WITH (timescaledb.continuous) AS
  SELECT device_id, time_bucket('1 day', fix_time) d,
         count(*) recs, max(odometer_m) odo_max, min(odometer_m) odo_min,
         sum(CASE WHEN ignition THEN 1 ELSE 0 END) ign_samples
  FROM positions WHERE fix_valid GROUP BY device_id, d WITH NO DATA;
SELECT add_continuous_aggregate_policy('daily_device_stats',
  start_offset=>interval '3 days', end_offset=>interval '1 hour', schedule_interval=>interval '1 hour');
```
`geocode_cache(grid_key text PK /* geohash7 ≈ 150 m cell — adequate for address caching */, address text, resolved_at)` — reverse-geocode only at report/UI render, cache-first, budget alarm on provider spend.

### 6.4 Trip state machine (unchanged from v1 §5.4 + fix_valid integration)
PARKED→MOVING: ignition=1 AND (movement=1 OR speed>6) sustained ≥90 s or ≥300 m (fix_valid displacements only). MOVING→PARKED: ignition=0 ≥180 s; no-ignition profile: speed<3 AND displacement<100 m for ≥5 min. Idle: ignition=1, speed<3 ≥120 s. Distance: prefer Δodometer_m when device odometer present & monotonic, else haversine over fix_valid points. Late historical batch overlapping closed trips ⇒ BullMQ `trip-recompute(device, window)` — idempotent (delete-overlap + replay). Thresholds in `device_profiles.presence_rules` jsonb.

### 6.5 Rules engine
Rule kinds & channels per v1 plan; per-rule cooldown default 300 s; priority-2 (panic) and `power_cut` bypass cooldown. `device_offline`: evaluated by a sweeper job every 60 s against profile presence rules (asset trackers: threshold from profile — TAT100 default 26 h). Every event persisted before notification attempted; notification failures retried by BullMQ (exp backoff, max 5), webhook signature `X-Signature: hmac-sha256(body, secret)`.

### 6.6 Public API v1 (Hono + zod-openapi; OpenAPI served at /v1/openapi.json)
Auth: `Authorization: Bearer <jwt>` (web) | `X-Api-Key` (integrations, scoped tenant/account).
`POST /v1/auth/login|refresh|logout` · `GET/POST/PATCH/DELETE /v1/devices[:id]` · `POST /v1/devices/import` (CSV) · `GET /v1/devices/:id/last` · `GET /v1/devices/:id/positions?from&to&cursor` (max 10k/page) · `GET /v1/devices/:id/trips?from&to` · `POST /v1/devices/:id/commands` + `GET /v1/commands/:id` · `GET/POST/… /v1/geofences`, `/v1/rules` · `GET /v1/events?from&to&kind&device_id&cursor` · `POST /v1/reports/:type` (async; result via `GET /v1/reports/jobs/:id` → signed download URL) · `GET/POST /v1/webhooks` · `GET/POST /v1/api-keys` · `POST /v1/accounts/:id/export` (GDPR data export, async job) · `POST /v1/public/pilot-request` (unauthenticated, rate-limited) · `GET /v1/ws-ticket` → `wss://…/v1/stream?ticket=`.
Conventions: cursor pagination everywhere; times ISO-8601 UTC in/out; errors RFC 7807.

### 6.7 Config (.env contract — CC adds new vars ONLY here + README table)
`DATABASE_URL, REDIS_URL, INGEST_TCP_PORT=5027, INGEST_MAX_CONN=20000, INGEST_MAX_CONN_PER_IP=200, JWT_SECRET, JWT_TTL=900, REFRESH_TTL=1209600, WS_TICKET_TTL=30, PUBLIC_API_URL, WEB_ORIGIN, TILES_STYLE_URL=https://tiles.openfreemap.org/styles/liberty, GEOCODER_URL=http://photon:2322, SMTP_URL|SES creds, MAIL_FROM, TELEGRAM_BOT_TOKEN, S3_ENDPOINT/KEY/SECRET/BUCKET (R2, exports), GLITCHTIP_DSN_API, GLITCHTIP_DSN_WEB, PROMETHEUS_PORT, LOG_LEVEL`.

---


### 6.9 Affiliate module (distilled SaaS best practice, minimal v1)
**Why:** friend's channel (10%) and partner affiliates (20%) must be one auditable mechanism, not spreadsheets.
**Attribution:** public site captures `?ref=<code>` → cookie `tc_ref` 60 days, **last touch wins** → pilot-request carries it → when tenant is created from that lead, `tenants.referred_by_affiliate_id` is set **once, immutable** (changes only by platform_admin with audit row). Self-referral guard: affiliate cannot refer a tenant whose admin email domain matches the affiliate's.
**Commission:** accrues on **collected revenue, not signups** — v1 (pre-Stripe): month-close job computes tenant invoice value from usage_daily × plan pricing, creates `commission_entries` (base_amount, rate, amount, period). Rate = platform default (20%) overridable per affiliate (friend = custom). Lifecycle: `pending` (30-day maturation) → `approved` → `paid` (manual transfer v1; affiliates invoice US — note reverse-charge VAT for PL affiliate ↔ LT MB) → `clawed_back` (refund/non-payment reverses entry, never deletes).
**Tables:** `affiliates(id, name, code UNIQUE, email, rate_pct, status, notes)` · `commission_entries(id, affiliate_id, tenant_id, period, base_amount_cents, rate_pct, amount_cents, status, created_at, status_changed_at)` · `tenants.referred_by_affiliate_id FK nullable`.
**API/UI:** platform_admin CRUD affiliates, entries ledger with status transitions, monthly statement CSV per affiliate, `POST /v1/public/pilot-request` (rate-limited, captcha-lite honeypot) storing lead + ref. **Out of scope v1 (say it in sales calls, don't improvise):** historical data import from Wialon/Traccar — pilots start with fresh positions; V2 candidate (CSV/API import). No self-serve tenant signup in v1 — tenants are created by platform_admin from pilot leads.
**V2:** affiliate self-serve portal, Stripe-automated payouts, multi-touch reporting.
**Anti-fraud v1 floor:** unique code per affiliate, entry requires collected revenue, maturation window, immutable attribution, everything audited.

## 7. Testing Strategy (non-negotiable gates)

1. **Golden packet corpus first** (`packages/codec/__fixtures__/`): every hex example from wiki Codec page (all codecs) + **hex packets harvested from Traccar's `TeltonikaProtocolDecoderTest.java` (Apache 2.0, attribution header in fixture file)** + captures from our 5 real devices (IMEI redacted via tool). Codec package target ≥95% branch coverage; property test: parse(encode(x)) == x for generated records.
2. **Simulator (`tools/simulator`)**: emits Codec 8E over TCP — **packet generation engine: the Go teltonika lib (encode support for all codecs incl. CRC) if its license checks out in W1, else a TS encoder written from wiki spec** — modes: live-drive (synthetic route @1 Hz), buffered-flood (N records, past timestamps, burst), panic, invalid-fix sequences, corrupt-CRC, oversized-length attack, slow-loris. Used by CI e2e (docker compose up → simulate → assert DB/WS/events) — **no story is Done if only tested against simulator-happy-path; buffered-flood + invalid-fix scenarios mandatory for pipeline stories.** Telemify (hosted emulator) is available for manual QA and sales demos, never CI.
3. **Replay harness (`tools/replay`)**: replays captured real-device logs at 1×–100× speed; the load-test gate (§5) uses 100 simulated + replayed mix.
4. Testcontainers (postgres+timescale+postgis image, redis) for integration; Vitest everywhere; Playwright smoke on web (login→map→device visible).
5. **Isolation suite** (§6.2) — CI-blocking from W3.
6. **Soak:** 72 h staging with 5 real devices + 500 simulated before pilot onboarding (W7–W8 overlap); memory RSS growth < 5%/24 h.
7. Time correctness tests: report totals across DST transition (Europe/Warsaw 2026-10-25) and TZ boundaries; all DB times UTC, conversion only at render with account TZ.

---

## 8. Delivery Plan — epics & stories (each story: 0.5–2 dev-days; AC = acceptance criteria)

**Pre-W0 (now):** order 5 devices (2×FMB920, FMB120, FMC130, TAT100) + SIMs (1NCE/Things Mobile); friend's two channel numbers; register domain; Hetzner account.

**W1 — Skeleton + first byte.**
S1 monorepo+CI+lint/typecheck gates (AC: PR pipeline red on type error). S2 Ansible/compose infra up, Postgres w/ timescale+postgis, Redis, **Photon container w/ PL+LT extracts** (AC: `make up` local & staging; reverse-geocode smoke test). S3 Prisma relational schema v1 + sql migrator for hypertable DDL §6.3 (AC: migrations idempotent from zero; **INSERT-into-compressed-chunk verification on pinned TS version, result recorded in audit**). S4 codec package: wrap chosen npm parser, dictionaries FMB1xx+FMC from wiki, golden corpus green incl. Traccar-harvested packets (AC: all wiki examples parse byte-exact; unknown-ID passthrough test; **simulator encode-engine decision recorded: Go lib license verified OR TS encoder chosen**). S5 ingest TCP: framing, handshake, CRC, XADD, ACK, per-IP caps + timeouts (AC: simulator happy-path + corrupt-CRC + oversize rejected). S6 point one REAL device at staging (Codec12/SMS `setparam` server-address doc written as we do it) (AC: real position row in DB). **Exit: your car in the table.**

**W2 — Pipeline + live map.**
S1 consumer groups + normalize + **batched INSERT…ON CONFLICT writer** + XAUTOCLAIM recovery (AC: I1–I3 green incl. worker-kill mid-batch chaos test). S2 live state + pub/sub + WS gateway w/ single-use ticket auth (AC: marker moves <2 s after simulator send). S3 backpressure I4 + metrics + Grafana ingest dashboard (AC: flood test triggers pause, zero loss). S4 web shell: auth, device list, MapLibre live map on **OpenFreeMap style** + clustering (AC: 500 simulated devices smooth). S5 invalid-fix handling end-to-end I5 (AC: gap rendered, no geofence eval). S6 buffered-flood e2e: pull SIM 2 h on real device (AC: history complete, ordered, no dupes). **Exit: 5 real devices live; flood test signed off.**

**W3 — Tenancy + device management.**
S1 tenants/accounts/users CRUD + RBAC middleware (roles: platform_admin, tsp_admin, account_manager, viewer). S2 scoped-repo layer + ESLint import ban + isolation suite (AC: suite CI-blocking). S3 device CRUD, profiles seed, bulk CSV import w/ dry-run report. S4 unknown-IMEI quarantine list + claim flow (AC: connect unknown device → appears → claim → data flows retroactively from claim moment). S5 branding theming (logo/colors/name) + tenant domain table + Caddy on-demand TLS (AC: two demo tenants on two domains). S6 audit_log on all mutations. **Exit: isolation suite green, 2 branded tenants.**

**W4 — Trips + history.**
S1 trip state machine + unit tests from recorded real fixtures. S2 recompute job (late batches) idempotency property test. S3 history API + playback UI (timeline scrub, speed chart, stop markers). S4 trips list + detail (route, stats). S5 odometer preference logic + per-device config. **Exit: W1–W4 real driving vs manual log ±5% distance; playback UX approved by both founders.**

**W5 — Geofences + rules + notifications.**
S1 geofence CRUD + map editor (polygon/circle, **terra-draw**). S2 geom cache (Redis) + transition detection w/ hysteresis (enter requires 2 consecutive fix_valid inside). S3 rules CRUD UI. S4 engine: overspeed/ignition/din/power_cut/low_battery/panic + cooldowns + offline sweeper. S5 email (**SES eu-central-1**) + Telegram channel (**pairing: one platform bot; account admin generates deep-link `t.me/<bot>?start=<token>`; /start binds chat_id to the account channel**), per-account channel config. S6 events timeline UI + filters. **Exit: real car crosses real geofence → Telegram <15 s; panic DIN test fires instantly.**

**W6 — Reports + public API.**
S1 report engine on positions+trips+events (+ caggs where possible): trips, mileage, stops, overspeed, geofence, engine-hours; account TZ correctness tests. S2 CSV/XLSX export via BullMQ job + signed URL. S3 public REST per §6.6 + API keys + rate limit (per-key token bucket, 600 req/min default). S4 webhooks + HMAC + retries + delivery log UI. S5 OpenAPI docs page (Scalar/Stoplight embed). *(nice: PDF export, scheduled reports)*. **Exit: external script pulls yesterday's trips via API key; webhook received & verified.**

**W7 — Ops + white-label polish + metering.**
S1 Grafana alert rules → founders' Telegram (stream depth, pipeline lag, parse-fail spike, disk, cert expiry). S2 pgBackRest + **restore drill on scratch server (AC: documented runbook, RTO <30 min demonstrated)**. S3 load-test gate §5 (AC: report committed). S4 usage metering (`usage_daily` from live registry) + platform admin panel (tenants, usage, health). S5 security pass: headers, rate limits, dependency audit, secrets scan, argon2 params, WS auth review. S6 72 h soak start. *(nice: Stripe metered)*. **Exit: soak green, restore drill done, load gate passed.**

**W8 — Pilot onboarding + i18n + polish.**
S1 onboarding docs: "migrate device to our server" (Codec 12 + SMS + FOTA paths, per-model notes) **+ legal pack: ToS with liability limits, DPA template, subprocessor list (Hetzner, AWS SES, Cloudflare R2, Telegram), OSM attribution in map UI**. S2 Codec 12 command UI + 10 presets (getinfo, getver, setparam reporting intervals, server address, cpureset, dout on/off, getgps, deleterecords warning-gated, getio). S3 i18n pass PL/DE priority + locale QA (**PL strings reviewed by a native speaker — friend's team or a paid reviewer; founder Polish is not sufficient for sales-facing copy**). S4 UX polish sprint from founder dogfooding list **+ `tools/seed-demo` (demo tenant with realistic fleet for sales calls)**. S5 seed pilot tenants + shadow-mode checklist. S6 buffer (there is always a snake). **Exit: first pilot connected with zero founder SSH.**

---

## 9. Claude Code Operating Model (why + how; details live in repo CLAUDE.md)

1. **One epic = one branch = one CC session arc.** Start every epic in Plan Mode; the plan is written to `docs/epics/W<N>.md` and approved by a human BEFORE code. Between stories `/clear`; context is rebuilt from plan files + CLAUDE.md, never from chat scrollback (context rot is the #1 quality killer in long sessions).
2. **Test-first for the two IP cores** (codec, trip engine): fixtures & failing tests committed before implementation. CC is instructed to refuse implementing pipeline stories without a named fixture.
3. **Reviewer subagent pass:** after each story, a FRESH session (or CC subagent) runs the "Adversarial Review" prompt from CLAUDE.md against the diff + AC; findings triaged before merge. Author-session never reviews itself.
4. **Hooks:** post-edit → `turbo run typecheck test --filter=<changed pkg>`; pre-commit → lint+format; block commit on red. CI mirrors locally-run gates (no "works on my machine").
5. **Protocol truth discipline:** any byte-level or AVL-ID claim in code/comments must carry a wiki URL. If CC cannot cite it, it must stop and mark `// TODO(VERIFY-WIKI)` — merging with that marker is CI-blocked.
6. **Forbidden zone (hard):** no ORM/Prisma on positions · no new runtime deps without ADR · no k8s/microservice split · no business logic in apps/ingest · no cross-package imports bypassing package API · no `Date` math without date-fns-tz + explicit zone · no floating promises (eslint) · no tenant-unscoped queries (lint + review) · no editing applied migrations · no silent catch.
7. **ADR process:** `docs/adr/NNN-title.md` (context/decision/consequences). Existing: 001 custom ingest vs Traccar (fallback trigger: W2 exit slips past day 18 ⇒ Traccar-headless Plan B), 002 ACK-after-durable, 003 Prisma boundary, 004 Redis Streams (revisit ≥50 k devices → Kafka), 005 no k8s, 006 DB placement after load test, 007 retention override mechanism.
8. **Definition of Done (every story):** AC demonstrably met · tests added & green · typecheck/lint green · metrics/logs added if pipeline touched · docs updated (README/env table/OpenAPI) · reviewer pass done · no VERIFY-WIKI markers.

## 10. Where CC Will Most Likely Fail — Top-12 Failure Map (each has a guardrail)

1 Endianness/signedness in binary parse → golden corpus + property tests. 2 ms-vs-s timestamps → fixture with known GMT string from wiki example. 3 Coordinate sign (two's complement) → southern/western hemisphere fixtures. 4 Treating invalid-fix as movement → I5 test. 5 Assuming arrival order = time order → I2 + buffered-flood e2e. 6 ACK before persist → I1 + crash-during-batch chaos test. 7 Tenant leakage in a "quick" query → scoped repos + lint ban + isolation suite. 8 TZ/DST bugs in reports → §7.7 tests, UTC-only rule. 9 Prisma sneaking into hot path → ESLint boundary + ADR-003. 10 WS auth via long-lived JWT in URL → ticket pattern enforced in review checklist. 11 Unbounded memory on socket buffers / stream growth → 4 KiB frame cap, MAXLEN, backpressure test, soak RSS gate. 12 Geofence flapping on GPS jitter → hysteresis (2 consecutive inside/outside) + cooldowns.

## 11. Business Risks (carried from v1, deltas only)
Channel numbers still the #1 unknown — request in W1, not after build. Official Teltonika partnership route opened in parallel (de-risks conflict-of-interest fragility). Second channel (SEO/dev-community) starts W6. Kill/pivot review at W8 if zero pilots lined up. Support saturation plan unchanged (hire PL/DE support ~€12–15 k MRR).

## 12. Open Questions (unchanged, answers steer W8+ go-to-market only)
Channel volume & DE/PL split · buyer profile (TSP vs fleet) · official partnership path · pilot names · €2/device price sniff test.

---

## 13. AUDIT LOG

### Rounds 1–2 (v1, retained)
R1 skeptical: F1 ACK-before-persist fixed · F2 order≠time fixed · F3 asset-tracker presence fixed · F4 geocoder self-host deferred · F5 Prisma/hypertable boundary · F6 restore-drill+load-test added · F7 UDP demoted · F8 billing descoped · F9 static overspeed only · F10 GPS-Trace anchor noted.
R2 validation: V1 feature↔week map · V2 data model covers reports · V3 perf arithmetic · V4 Timescale license flag (now closed, see R3) · V5 GDPR path · V6 ordering-vs-scale ceiling · V7 W1 realism · V8 no channel dependency in build · V9 AVL overconfidence purged.

### Round 3 — Source verification (this revision; primary sources fetched)
- ✅ Handshake, ACK semantics, packet structure, CRC span, NumberOfData1==2, size limits (1280/512 B), timestamp ms, priority values, coordinate 1e7 two's-complement — confirmed against wiki /view/Codec; plan §3 rewritten to normative with citations.
- 🆕 **Invalid-fix behavior discovered** (last-valid coords + zeros) — was absent in v1; added §3.4 rule + invariant I5 + failure-map #4. This alone would have produced phantom geofence events and inflated mileage in pilots.
- 🆕 Panic priority (2) surfaced into rules engine bypass.
- ✅ AVL core IDs cross-verified (239/240/21/66/78/241 corroborated by wiki table + Codec-page worked example + Traccar forum); Escort LLS 269/270 confirmed family-specific ⇒ dictionary-generation rule retained as mandatory.
- ✅ TimescaleDB licensing resolved from tigerdata.com legal + editions docs: Community/TSL self-hosted prod use incl. compression & caggs is free; prohibition = offering the DB itself as a service; naming requirement noted. V4 flag closed; DDL in §6.3 uses Community features deliberately.
- ✅ Traccar backend + modern web Apache 2.0 re-confirmed (fallback & reference use compliant).
- Corrected: v1 said "Timescale (Apache/TSL)" ambiguously — now explicit Community Edition.

### Round 4 — Consistency & completeness
- Fixed v1 ambiguity: §3-table said "BullMQ hash-partitioned queues" for ordering while §5.1 said Redis Streams — unified: Streams=ordered pipeline, BullMQ=async jobs (§5, §6.1).
- Every V1-MUST traced to a week story AND an API endpoint AND a table; gaps found & filled: usage metering endpoint (admin panel W7 S4), commands GET added to API list, ws-ticket endpoint added, geocode_cache table added to model list.
- Env contract cross-checked against integrations (Telegram, geocoder budget, S3 exports present).
- Port 5027 standardized everywhere; simulator scenarios list matches invariants I1–I5 one-to-one.
- Cross-file check PROJECT_PLAN ↔ CLAUDE.md: shard formula, port, ACK contract, invalid-fix rule, Prisma boundary all match; found & fixed one gap (tools/redact existed in CLAUDE.md but not in the monorepo map).
- Week loading sanity: W2 and W5 are the heaviest; explicit nice-to-have deferrals marked; W8 contains buffer story.

### Round 5 — Adversarial "where does CC drift" walkthrough
Simulated CC failure modes per epic against guardrails: (a) W1 S4 — CC hand-rolls parser instead of wrapping lib → CLAUDE.md hard rule + story wording "wrap chosen npm parser"; (b) W2 — CC uses per-record INSERT → story AC names batched INSERT…ON CONFLICT + load gate would catch; (c) W3 — CC adds `where tenant_id` manually in a new endpoint → scoped-repo ban + isolation suite; (d) W4 — CC recomputes trips synchronously in consumer → recompute is a named BullMQ job in story; (e) W5 — CC evaluates geofences with PostGIS per record → geom-cache story precedes engine story; (f) W6 — CC returns naive local times → §7.7 tests; (g) global — dependency sprawl → ADR gate + lockfile review in DoD; (h) global — CC "fixes" a failing golden test by editing the fixture → CLAUDE.md rule: fixtures immutable without wiki citation + human sign-off. All 8 scenarios have a live guardrail. Residual highest risk accepted & monitored: real-device edge cases W2–W4 (mitigated: 5 devices day one, Traccar oracle, fallback ADR-001).

### Round 6 — Free/OSS cost audit + tooling discovery (sources fetched)
- **Tiles → OpenFreeMap** (verified: free public instance, no keys/limits/registration, OpenMapTiles schema, MapLibre-native, full self-host scripts published; prebuilt image needs ~300 GB SSD + 4 GB RAM). MapTiler demoted to env-var emergency fallback. Tile cost: €0 permanently.
- **Geocoding → self-hosted Photon** (verified: Apache 2.0, GraphHopper weekly prebuilt COUNTRY extracts eliminate Nominatim import, docker image exists). Komoot public instance = dev-only fair-use. LocationIQ dropped from the plan. Geocode cost: €0.
- **Simulator engine found:** Go teltonika lib implements encode+decode for Codecs 8/8E/16/12/13/14 incl. CRC — removes the hardest simulator work; license verification is a W1 AC with TS-encoder fallback.
- **Golden corpus source #2:** Traccar decoder test file contains real hex packets (Apache 2.0, harvest with attribution).
- Telemify (hosted Teltonika emulator) catalogued for demos/manual QA; excluded from CI by rule.
- terra-draw (MIT) selected for geofence editor; exceljs (streaming) for XLSX; GlitchTip default over Sentry SaaS; SES over Postmark.
- Cost model table added (§5): total infra ≈ €75–90/mo with tiles/geocoding/monitoring at €0. Free-first mandate codified: every paid line must name its free alternative.
- Flespi engineering article independently corroborated two plan decisions: per-model AVL ID divergence (our dictionary rule) and device TLS support (our V2 hardening path).

### Round 7 — Completeness sweep (what was still missing)
- **Security honesty section added (§6.1):** IMEI-only device auth is spoofable and is the industry norm; v1 posture documented (per-IP caps, handshake rate-limit, quarantine) with V2 hardening path (TLS listener, teleport filter). Sales guidance: never claim tamper-proof.
- Ingest anti-abuse specifics: SO_KEEPALIVE, per-IP conn cap 200, handshake timeout 10 s, profile-driven read-idle timeout.
- Telegram pairing flow specified (deep-link /start token → chat_id binding) — was hand-waved.
- Staging environment made explicit (CPX31, same compose); legal pack (ToS/DPA/subprocessors/OSM attribution) added to W8; `tools/seed-demo` added for sales demos.
- Backpressure ordering clarified: persist → ACK → depth-check → pause (never pause before ACK of an accepted packet).

### Round 8 — Deep technical red-team (bugs found in OUR OWN v2 plan)
- **R8-1 (real bug): PostgreSQL COPY does not support ON CONFLICT** — v2 pipeline said "COPY" while invariant I3 required `ON CONFLICT DO NOTHING`. Irreconcilable as written. Fixed: hot path = batched multi-row INSERT…ON CONFLICT (500-row batches; 3 batches/s at burst target — ample); COPY relegated to a future staging-table optimization (ADR-008). CLAUDE.md rule 1 updated to match.
- **R8-2 (real risk): late buffered records vs compressed chunks** — devices offline longer than compress_after flood records into already-compressed chunks; insert + unique-constraint behavior there is TimescaleDB-version-dependent. Fixed: compress_after 7→14 days, W1 verification test on pinned version, decompress_chunk fallback documented in recompute path.
- **R8-3 (real design conflict): per-tenant retention vs time-partitioned chunks** — chunks span all tenants, so per-tenant retention cannot drop chunks; v2's "tenant-configurable retention" was architecturally impossible as stated. Fixed: platform-wide raw retention (13 mo, cheap chunk drops) is the ceiling; shorter per-tenant retention = V2 delete-by-device job; ADR-007 rewritten.
- **R8-4: Redis memory math** — MAXLEN 1M×16 shards ≈ up to ~24 GB worst case. Resized: MAXLEN 100k/shard, backpressure at 50k (≈9 min of burst with consumers down; devices then buffer — by design).
- R8-5: consumer-crash recovery was unspecified — XAUTOCLAIM (min-idle 60 s) added with worker-kill chaos test in W2 AC.
- R8-6: ws-ticket hardened to single-use + 30 s TTL; Caddy on-demand-TLS ask endpoint noted as rate-limited.
- R8-7: `angle` (protocol) vs `course` (DB) naming mapped explicitly in DDL comment to prevent a silent field mix-up.

### Round 9 — Product/perspective improvements
Device-health view added to V1-nice (GSM/voltage/FW/last-seen — deflects the most common TSP support calls at trivial build cost since all fields already flow through the pipeline). GDPR data-export endpoint made explicit in the API surface. Native-PL review requirement added to W8 i18n (sales-facing copy quality ≠ founder-level Polish).

### Round 10 — Technical re-verification
- Fixed geohash7 cell-size claim (≈150 m, not 76 m — 76 m is precision 8 territory); still fit for address caching.
- rec_hash signedness trap documented: xxhash64 is unsigned; values >2^63−1 must be reinterpreted as signed two's-complement before hitting PG bigint, or inserts fail intermittently and only on ~50% of hashes — a classic heisenbug pre-empted.
- Redis backup posture made explicit: transient-by-design, no dumps needed (devices re-send unACKed; AOF covers ACKed-in-flight; live state rebuilds).
- Column-type sweep re-run: speed/altitude/course smallint ranges verified against protocol maxima; Codec 12 response correlation-by-socket-order assumption confirmed documented in §3.5.

### Round 11 — Hand-off readiness
Hand-off package extended to four files (plan, CLAUDE.md, IMPLEMENTATION_PLAN.md, CC_PLAYBOOK.md); §9 operating model remains the summary while the playbook becomes the full guide. Confirmed no story in §8 depends on information that exists only in this conversation — every decision is written down.

### Round 12 — Public web, dashboard UI spec, affiliate module
Public marketing site added as Lovable-built `apps/site` (PUBLIC_WEB_LOVABLE.md) — same stack, zero CC time except review; stat claims gated on measured numbers. Dashboard UI fully specified in DASHBOARD_UI_SPEC.md (canonical tokens; shadcn-only rule; every screen mapped to a story — two ownership gaps found & fixed: Reports UI → E06-2, Settings/Profile → E03-2). Affiliate module (§6.9) designed to SaaS best practice with minimal v1 scope: last-touch 60-day attribution, commissions on collected revenue with 30-day maturation, immutable referral binding, manual payouts; lands as E09 in W9 alongside pilot shadow mode. Compatibility verified: free-stack mandate holds on the site (self-hosted fonts, OpenFreeMap/static map), affiliate friend-deal and 20% partner program now share one audited mechanism. Capacity impact +≈3.5 dev-days — reinforces the R5 recommendation to plan 10 weeks (Option A).

### Round 13 — Final pre-handoff gap sweep
Eight findings, all patched: (1) Redis `noeviction` mandate + memory alert — a silent BullMQ-corruption bug pre-empted; (2) graceful SIGTERM drain protocol for ingest/workers — weekly deploys must not create ACK-window data loss; (3) Impressum page added (TMG §5 — DE market legal requirement) + minimal consent notice gating the affiliate ref-cookie; (4) self-hosted Umami analytics (MIT, cookieless, €0) — the marketing site was flying blind; (5) Wialon/Traccar history import declared explicitly out-of-scope v1 with a prepared sales answer (V2 candidate); (6) affiliate agreement template — considered, then dropped by founder decision (friend-based channel; formalize only if unrelated third-party affiliates ever join); (7) forward geocoding search (Photon) on map + geofence editor, and course-based marker rotation; (8) minors: chrony, Loki retention 30 d, auth lockout, "no self-serve signup" made explicit, E00-5 name/domain/trademark check before the public site ships (TrackCore is a codename!), GDPR Art. 30 register + external pentest ticket in the security/legal lists.

**Post-R13 confidence statement:** three genuine defects (R8-1/2/3) were found and fixed at document stage — exactly the failure class that would otherwise have surfaced as production incidents in W2 and month 3 respectively. The free-stack mandate is now fully satisfied with named, verified components at €0 marginal cost for maps, geocoding, and observability. Remaining accepted risks: IMEI spoofability (industry-standard posture, documented), TimescaleDB compressed-insert behavior (W1 verification gate), channel throughput (external, being measured).

---
*Hand-off contents: this file + CLAUDE.md + IMPLEMENTATION_PLAN.md (epic/story backlog) + CC_PLAYBOOK.md (Claude Code operating guide) at repo root + golden corpus as first commit. Build order = IMPLEMENTATION_PLAN epics.*
