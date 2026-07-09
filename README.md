# Orbetra

Multi-tenant, white-label GPS tracking platform for Teltonika devices.
Normative spec: [PROJECT_PLAN.md](PROJECT_PLAN.md) · backlog: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) · operating rules: [CLAUDE.md](CLAUDE.md).

## Setup

```sh
nvm use            # Node 22 (.nvmrc)
npm i -g pnpm@10   # once per machine (corepack currently broken with pnpm 10+)
pnpm install       # also auto-installs git hooks (prepare -> core.hooksPath)
```

## Development

```sh
pnpm turbo run typecheck lint test   # all quality gates (alias: make gates)
pnpm turbo run dev --filter=<app>    # once apps have dev servers
```

The pre-commit hook re-runs the gates for staged packages and their dependents
(turbo cache makes this near-instant when they already passed). Commits touching
`packages/codec/__fixtures__` additionally require a `FIXTURE-APPROVED:` trailer
in the commit message, and any staged `TODO(VERIFY-WIKI)` marker blocks the commit
(see CLAUDE.md rules 8–9).

## Monorepo

| Path | Purpose |
|---|---|
| `apps/ingest` | raw TCP ingest: framing, handshake, CRC, parse, XADD, ACK — zero business logic |
| `apps/worker` | stream consumers (ordered pipeline) + BullMQ jobs |
| `apps/api` | Hono REST + WS gateway |
| `apps/web` | React SPA (Vite, MapLibre, TanStack, shadcn) |
| `packages/codec` | Teltonika parser wrapper + AVL dictionaries + golden fixtures |
| `packages/db` | Prisma (relational) + raw SQL layer for positions + scoped repositories |
| `packages/shared` | zod schemas — single source of types |
| `tools/simulator` | device emulator (scenarios per PROJECT_PLAN §7.2) |
| `tools/replay` | real-log replayer for load tests |
| `tools/redact` | strips real IMEIs from captures before they become fixtures |

## Environment variables

Every new variable must be added to the table here AND match the `.env` contract
(PROJECT_PLAN §6.7).

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | packages/db (`make migrate`, Prisma, raw SQL pool) | PostgreSQL 16 + TimescaleDB + PostGIS connection string |
| `REDIS_URL` | apps/ingest | Redis connection (streams + registry), default `redis://127.0.0.1:6379` |
| `INGEST_TCP_PORT` | apps/ingest | Teltonika TCP listener port, default `5027` |
| `INGEST_MAX_CONN` | apps/ingest | Total concurrent connection cap, default `20000` |
| `INGEST_MAX_CONN_PER_IP` | apps/ingest | Per-IP connection cap, default `200` |
| `PROMETHEUS_PORT` | apps/ingest (9101), apps/worker (9102) | /metrics exposition port |
| `API_PORT` | apps/api | HTTP+WS port, default `3010` |
| `JWT_SECRET` | apps/api | HS256 access-token secret, **required**, min 32 chars |
| `JWT_TTL` | apps/api | Access-token TTL seconds, default `900` (15 min) |
| `REFRESH_TTL` | apps/api | Refresh-token TTL seconds (sliding), default `1209600` (14 d) |
| `LOCKOUT_MAX_FAILS` / `LOCKOUT_WINDOW_S` | apps/api | Login lockout (§6.1), defaults `5` / `900` |
| `COOKIE_SECURE` | apps/api | `0` disables the Secure cookie flag (dev/e2e over http ONLY) |
| `TRUST_PROXY` | apps/api | `1` = trust X-Forwarded-For for lockout + caddy-ask IPs (behind Caddy) |
| `ASK_RATE_MAX` / `ASK_RATE_WINDOW_S` | apps/api | Caddy on-demand-TLS ask throttle per source IP (E03-5), defaults `10` / `60` |
| `ORBETRA_PUBLIC` | infra/Caddyfile (staging/prod) | `true` enables the on-demand-TLS `https://` site block for tenant custom domains |
| `DATABASE_URL` | apps/api (E03-1+) | required — auth reads users/refresh tokens via @orbetra/db |
| `VITE_TILES_STYLE_URL` | apps/web (build-time) | MapLibre style URL, default OpenFreeMap `liberty` (`TILES_STYLE_URL` web counterpart, §6.7) |
| `VITE_API_URL` | apps/web (build-time) | API origin override; unset = same-origin (dev proxy / prod Caddy) |
| `API_PROXY_TARGET` | apps/web vite dev/preview server | Where the `/v1` proxy forwards (http+ws), default `http://localhost:3010` |

## Scoped repositories & isolation (E03-2)

- **All relational DB access goes through `packages/db` scoped repos** (`createDb(url)`).
  `@prisma/client` is lint-banned outside `packages/db` AND asserted by a test
  (`tests/isolation/prisma.spec.ts`). Every repo method takes a `Scope`
  (`{tenantId, accountId?}`) first; the tenant boundary is centralized in `scopedWhere`.
- **Scoped CRUD API** (manifest-driven, `apps/api/src/routes/crud.ts`): `/v1/{accounts,
  users,rules,webhooks,events}` + `/v1/tenants` (platform_admin) + `POST /v1/auth/password`.
  Routes register from the exported manifest so it cannot drift from the live app.
- **Isolation suite** (`pnpm test:isolation`, CI-blocking via `turbo run test`, needs
  Docker): iterates the route manifest cross-tenant/-account expecting 404/403; a
  meta-test fails if a `/v1` route is registered without a manifest entry.

## Devices (E03-3)

- `pnpm db:seed:profiles` seeds the four device profiles (fmb1xx, fmc, fmb6xx-stub,
  tat-asset). Create devices via the web Devices page or `POST /v1/devices`; each
  create/retire **syncs the ingest/worker Redis registries** (`registry:imei`,
  `device:tenant`, `device:account`) — a device is invisible to ingest until created
  and rejected (0x00) on the next connect after retire.
- **CSV bulk import**: `POST /v1/devices/import/preview` (dry-run diff: create/update/
  error rows; per-row IMEI-Luhn + dup + unknown-profile validation) then
  `POST /v1/devices/import` to apply. Columns: `imei,name,profileKey,accountId`
  (a tenant-wide caller must name the account per row; an account-scoped caller is
  pinned to their own).
- **Quarantine & claim (E03-4, platform_admin only)**: unknown IMEIs that hit ingest
  are 0x00-rejected and land in the `quarantine:imei` Redis zset. `GET /v1/quarantine`
  lists them (with reject counts); `POST /v1/quarantine/:imei/claim`
  `{tenantId,accountId,profileId,name}` creates the device in the **target** tenant
  (account validated against it), populates the registry, and drops it from
  quarantine → the next connect is accepted. `GET /v1/tenants/:id/accounts` feeds the
  claim dialog's account picker. The Quarantine section on the Devices page renders
  only for platform_admin.

## White-label branding & custom domains (E03-5)

- **Branding** (Admin → Branding, `tsp_admin`/`platform_admin`): `GET/PATCH
  /v1/tenant/branding` edits the tenant's own logo/colors/product name/support email
  (tenant taken from the JWT — **never** a path param). Colors are validated `#rrggbb`
  server-side (`brandingSchema`) so they can only reach the browser as a CSS custom
  property, never as arbitrary style; `logoUrl` is https-only. The web app applies them
  live (`--accent` / `--accent-2`, with a WCAG-AA auto-lighten fallback so a near-black
  accent can't vanish on the dark surface) and after login.
- **Custom domains**: `GET/POST/DELETE /v1/tenant/domains` + `POST
  /v1/tenant/domains/:id/verify`. Adding a domain returns a DNS TXT token
  (`orbetra-verify=<token>`); the verify route confirms it via a DNS resolver
  (injectable for tests). A domain is `pending` until verified, `verified` after.
- **On-demand TLS**: `GET /v1/internal/caddy-ask?domain=` answers Caddy's ask hook —
  200 only for a **verified** tenant domain, 403 otherwise, throttled **per requested
  domain** (`ASK_RATE_MAX`/`ASK_RATE_WINDOW_S`; every ask shares Caddy's source IP, so
  a per-IP bucket would be one global choke point). Caddy's own `interval`/`burst` is the
  coarse global bound. Set `ORBETRA_PUBLIC=true` to enable the
  `https://` site block in `infra/Caddyfile`; certs are then minted automatically on the
  first HTTPS hit to a verified domain. Full 2-domain TLS is exercised on staging (no
  `:443`/real DNS locally).
- **Pre-login branding**: public `GET /v1/branding` resolves the tenant by `Host`
  (`X-Forwarded-Host` behind Caddy) → verified domain → branding, so a custom-domain
  login page shows the tenant's logo before authentication; unknown host → `{}`.
- **Branded email**: `renderBrandedEmail(branding, tenantName, content)` renders the
  tenant's name/logo/accent with all tenant strings HTML-escaped (snapshot-tested).

## Trips (E04-1)

- **Trip state machine** (`apps/worker/src/trip/engine.ts`, §6.4) — a pure, deterministic
  engine driven by record `fixTime` (never wall-clock, so replays are stable). It consumes
  **fix_valid** records only (the I5 seam `motionRecords` filters invalid fixes upstream, so
  an invalid fix can never move trip distance) and emits `open`/`close` events.
  - PARKED→MOVING: ignition on AND (movement OR speed > `moveSpeedKmh`) sustained
    `movingSustainS` **or** `movingDisplaceM` of travel; the trip opens retroactively from the
    candidate start. MOVING→PARKED: ignition off `parkedIgnitionOffS` (asset/`noIgnition`
    profile: slow + small displacement `parkedStopS`). Idle accrues when ignition-on and
    crawling for `idleSustainS`.
  - Distance prefers the device odometer when present and monotonic for the whole trip
    (`distanceSource='odometer'`), else haversine over fix_valid points (`'gps'`).
  - E04-1 uses `DEFAULT_THRESHOLDS` for every device; per-device `presence_rules` selection
    (and asset/no-ignition trackers) wires up in E04-5.
- **Persistence** (`apps/worker/src/trip/{writer,persister}.ts`) — the worker resolves each
  device's tenant/account from the Redis registry (`device:tenant`/`device:account`) and
  writes `trips` rows (`open` on start, `closed` on stop; close is guarded on `status='open'`
  so a replay is a no-op). A trip is never written with a guessed tenant. Metrics:
  `trips_opened_total`, `trips_closed_total`.
- **Recompute** (E04-2, `apps/worker/src/trip/recompute.ts` + `jobs/`) — the streaming
  engine drops out-of-order records, so a late/buffered batch (§3.6) can't reconcile
  already-persisted trips. `recomputeTrips(device, window)` rebuilds trips **authoritatively**
  from the durable `positions`: it expands the window to whole-trip boundaries, replays a
  fresh engine, then **delete-overlap + insert in one transaction** — idempotent (running it
  twice over the same positions yields identical trips; proved by a property test). Delivery
  is a **BullMQ** `trip-recompute` job (ADR-020, Redis `maxmemory-policy noeviction`): when the
  engine drops a late record it flags the device (`takeLate()`) and the worker enqueues a
  deduped job (`recompute:{device}:{hour}`). Scope prefers an existing trip's tenant (so a
  re-claim never moves historical trips), else the registry. Metrics: `trip_recompute_total`,
  `trip_recompute_deleted_total`.
  - **Recompute only reconciles settled, closed history** (`to = now − 15 min`) and never
    touches `open` rows — the live streaming persister owns those, so a recompute can't race
    or delete the in-progress trip. delete + insert are keyed on the exact core time span, so
    a neighbour trip pulled into the read margin is never bisected.
- Real-drive ±5 % distance validation is the W4 exit (post-hardware).

## History & playback (E04-3)

- **Read API** (§6.6): `GET /v1/devices/:id/positions?from&to&cursor&limit` (raw-SQL over the
  positions hypertable, chronological, keyset cursor on `(fix_time, rec_hash)`, `limit` clamped
  to 10k) and `GET /v1/devices/:id/trips?from&to` + `GET /v1/trips[/:id]` (scoped Prisma read).
  Both device sub-routes **gate on `db.devices.get(scope, id)` first** (404 for an out-of-scope
  device) before touching positions — the isolation suite covers them automatically. Every query
  param is sanitized so garbage never 500s.
- **Web playback** (`/app/playback`, nav Fleet → History) — pick a device + time range and replay
  its trail on MapLibre (reusing `buildTrailFeatures`, so no-fix stretches render as dashed gaps,
  I5), with trip start/end **stop markers**, a hand-rolled SVG **speed chart** (no chart
  dependency), and a **scrub** slider that moves a cursor dot along the trail. Timestamps render in
  the browser locale.

## Per-device trip config (E04-5)

- The trip engine now applies **per-device** thresholds and odometer preference (E04-1 used
  one default for all). Each device's profile `presence_rules` (§6.4, incl. the asset
  `noIgnition` mode) + its `odometerSource` (`auto`/`device`/`gps`) are synced into Redis
  `device:config` by the registry on create/claim/import (and on a PATCH that changes them).
  The worker resolves them per batch through a short-TTL cache and feeds them to the engine.
- **Odometer preference** (§6.4): `gps` forces haversine; `device` uses the device odometer
  whenever start+end are present and non-decreasing (tolerant of intermediate gaps); `auto`
  additionally requires monotonicity throughout, else falls back to haversine.
- **UI**: the Devices page create form + an inline per-row select set `odometerSource`.
- A config change (Redis TTL ≈60 s) takes effect on the device's **next trip** (never mid-trip),
  and the authoritative E04-2 recompute reads the same `device:config`, so live and reconciled
  trips stay consistent. A profile-content edit re-syncs on the device's next registry write
  (full profile-edit propagation is a follow-up).

## Geofences (E05-1)

- **CRUD API** `GET/POST/PATCH/DELETE /v1/geofences` — account-scoped, `accountId` nullable
  (`null` ⇒ tenant-shared, visible to all accounts). The `geom` column is
  `geography(Polygon,4326)`, so the repo (`packages/db/repos/geofences.ts`) uses
  parameterized `$queryRaw` PostGIS (`ST_GeomFromGeoJSON`/`ST_AsGeoJSON`), still scope-first.
  Every geometry is server-validated (`ST_IsValid` → 400 on self-intersection) and
  area-capped (`ST_Area ≤ 10,000 km²`, §6.3 → 400); GeoJSON is a bound string param, never
  concatenated. Circles are stored as their polygon approximation (`kind` is UI metadata).
- **Editor** (`/app/geofences`, nav Automation → Geofences) — draw polygon/circle with
  **terra-draw** (ADR-021, MIT, MapLibre-native) on the OpenFreeMap map; existing geofences
  render as coloured fills; name/colour + save; list with delete. i18n ×4.
- **Transition detection** (E05-2, worker) — geofence CRUD publishes geometries to Redis
  (`geofence:tenant:{id}`); the worker resolves each device's applicable fences (own account
  + tenant-shared) through a short-TTL geom cache and runs a pure point-in-polygon engine
  with **hysteresis** (enter/exit confirmed only after 2 consecutive fix_valid observations on
  the new side, so boundary jitter can't flap). Invalid fixes never move geofence state (I5).
  Confirmed transitions are written as `events` (`kind='geofence'`, payload = geofenceId +
  enter/exit); metric `geofence_events_total`. Containment is planar on lon/lat (an excellent
  approximation within the 10,000 km² cap). Rule evaluation + notifications are E05-4.

## Reports UI + CSV export (E06-2)

- **Web** `/app/reports` (nav Insights → Reports) — pick a report type + device + date range,
  Run, and view the rows in a table. **Export CSV** is client-side (RFC-4180, Blob download —
  no server round-trip, no storage backend). Consumes the E06-1 sync API; the account
  timezone is applied server-side.
- The plan's **async** server-side XLSX export (BullMQ → exceljs → R2 signed URL, for large
  or scheduled exports) is a follow-up — it needs R2/S3 credentials (`S3_ENDPOINT/KEY/…`) and
  an exceljs ADR.

## Reports (E06-1)

- **API** `POST /v1/reports/:type` (account-scoped) — `type` ∈ `trips · mileage · stops ·
  overspeed · geofence · engine_hours`; body `{ from, to, deviceId?, accountId? }` (a
  tenant-wide caller must name an `accountId`; an account user's is fixed by their token).
  Returns JSON rows.
- **Engine** (`packages/db/reports.ts`) — scoped raw SQL over trips + events (aggregation
  Prisma can't express). **Day bucketing is account-timezone-correct**: `at AT TIME ZONE $tz`
  runs the offset math **in Postgres** (DST-aware, incl. the Europe/Warsaw 2026-10-25
  fall-back — §7.7). All timestamps stored UTC; the account's IANA zone converts only here.
  Every query is bounded by the caller's tenant + account; params are sanitized (garbage
  dates/deviceId never 500). Async CSV/XLSX export is E06-2.

## Notification dispatch (E05-5)

- **Worker** — after a rule event is durably persisted (E05-4), it's enqueued on a BullMQ
  `notify` queue; the notify worker loads the rule's `channels` from the DB and delivers the
  message to each. **Retry is BullMQ's** (`attempts: 5`, exponential backoff — §6.5). A
  per-job Redis sent-set gives **per-channel idempotency**: a retry re-attempts only the
  channels that failed, never re-sending a delivered one.
- **Channels** — a rule's `channels` (validated by `notificationChannelSchema`) are `email`
  (`{to}`) and `telegram` (`{chatId}`). **Drivers are env-gated**: a channel whose
  credentials are absent is *skipped* (metric `notification_skipped_total{reason}`), not
  failed. Telegram sends via the Bot API (`TELEGRAM_BOT_TOKEN`); email takes an injected
  SMTP/SES transport. Metrics `notification_sent_total{channel}` / `_failed_total{channel}`.
- **BLOCKED-INFO** (founder must provision): AWS SES production access + `MAIL_FROM` for real
  email; `TELEGRAM_BOT_TOKEN` (+ the pairing deep-link that binds a `chat_id`) for Telegram.
  Until then those channels are skipped. Per-account channel config UI + Telegram pairing +
  the webhook channel (E06-4) are follow-ups; the dispatch pipeline + retry are done.

## Events timeline (E05-6)

- **Web** `/app/events` (nav Automation → Events) — the pipeline's rule/geofence output
  (E05-2/4) as a reverse-chronological timeline. Filter by **kind**, **device**, and a
  **time range** (`from`/`to`); each row shows a kind-specific one-line summary and expands
  to the raw `payload`. Cursor-paginated (newest first, "Load more").
- **API** `GET /v1/events?kind&deviceId&from&to&cursor&limit` (account-scoped, read-only).
  All query params are sanitized in the events repo (mirrors the audit repo) — a malformed
  cursor/date/deviceId is ignored rather than 500-ing.

## Rules (E05-3)

- **Web** `/app/rules` (nav Automation → Rules) — create alert rules over the existing
  `/v1/rules` API with **kind-specific config**: overspeed (speed km/h), geofence (fence +
  enter/exit/both), low_battery (threshold V), device_offline (after hours); ignition /
  din_change / power_cut / panic are event-driven (no threshold). Per-rule cooldown, an
  inline enabled toggle, and delete. The rule **engine** that evaluates these + fans out
  notifications is E05-4.

## Rule engine (E05-4)

- **Worker** — rule CRUD publishes enabled rules to Redis (`rule:tenant:{tenantId}`,
  ruleRegistry.ts); the worker resolves each batch's devices → their account-scoped rules
  (`RuleCache`, short TTL) and evaluates them per batch. Unlike trips/geofences the engine
  is fed the **full** batch (not the I5 motion filter): IO events (ignition / din_change /
  power_cut / low_battery / panic) fire on invalid-fix records too (§3.4), while **overspeed
  self-guards on `fixValid`** (rule 6) — an invalid fix never triggers a speed alert.
- **Kinds** — overspeed (`speed` vs `config.speedKmh`, level), low_battery (Battery Voltage
  AVL 67 × 0.001 V vs `thresholdV`, level), ignition (AVL 239 transition), din_change
  (Digital Input 1, AVL 1, transition), power_cut (Unplug AVL 252 rising edge), panic (Alarm
  AVL 236 rising edge). Edge kinds track last-IO state in Redis (`rule:iostate:{deviceId}`)
  and **warm-start** it so a worker restart doesn't re-fire.
- **Cooldown** — per-rule (default 300 s) via atomic `SET NX EX` on `rule:cd:{ruleId}:{deviceId}`,
  making event emission idempotent under the ACK-replay window. **panic + power_cut bypass**
  the cooldown (§6.5 priority-2). Events are persisted to `events` (with `ruleId` + `kind`)
  before any notification; the notification channels (email/Telegram) are E05-5. Metric
  `rule_events_total{kind}`.
- **device_offline sweeper (E05-4b)** — a repeatable BullMQ job (every 60 s, off the hot
  path) scans device presence against each account's `device_offline` rules. A device is
  offline when its last fix (`device:{id}:last`) is older than the threshold —
  `config.afterH`, else the profile's presence `offlineAfterH`, else 26 h (TAT100 default).
  A per-device fired-flag (`rule:offline:{deviceId}`) fires the event once per episode and
  resets on recovery. Devices that never reported are skipped.

## Trips list & detail (E04-4)

- **Web** `/app/trips` (nav Fleet → Trips) — filter trips by device + time range in a table
  (start, duration, distance + `odo`/`gps` source, max speed; an in-progress trip is badged
  *Ongoing*). Selecting a row shows its **route** on the map (reusing `PlaybackMap` over the
  trip's positions window) plus a **stats** card (duration, distance, max speed, idle).
  Reads the E04-3 trips + positions API; an open trip's duration runs to now.

## Audit log (E03-6)

- Every scoped mutation already writes one `audit_log` row (who/action/entity/entityId/
  before/after/at) — enforced by `packages/db/__tests__/audit-coverage.spec.ts`, which
  drives **every** mutating repo through create/update/delete and fails if a row is
  missing (so a new repo that forgets `audit.record` turns the build red). Secrets are
  redacted in snapshots (webhook `secret` → `***`; user `passwordHash` never selected).
- **Read**: `GET /v1/audit` (+ `GET /v1/audit/:id`) — tenant-scoped, **admin-only**
  (`TENANT_ADMINS`; viewer/account_manager → 403). Filters `entity`, `action`,
  `from`/`to`, cursor pagination (`limit`/`cursor`, id desc). Append-only — no write API.
- **Web**: Admin → Audit (nav shown only to admins) — filterable table with expandable
  before/after snapshots; timestamps render in the browser's locale/timezone.

## Web app (E02-6)

- Dev: `turbo run dev --filter=@orbetra/web` (Vite on :5173, `/v1` proxied to :3010).
- Login (E03-1): email + password. Create a dev user first:
  `pnpm db:seed:user -- --email you@dev.test --password 'pick-one' --role tsp_admin --tenant-name "Dev Tenant"`
  (prints `{tenantId,…}` — pass that tenantId to `pnpm sim:seed -- --tenant <id>` so
  simulated devices land in your tenant). Password reset is manual in v1.
- **500-device demo (AC E02-6):** `make up`, run migrations, start ingest
  (`INGEST_MAX_CONN_PER_IP=1000` — the fleet is one IP), worker, api, then:
  `pnpm sim:seed -- --devices 500 && pnpm sim -- --scenario liveDrive --devices 500 --count 600 --hz 1`
- E2E smoke: `pnpm --filter @orbetra/web e2e` (Docker required; boots the full stack via testcontainers).
- **Manual checks (documented per AC):**
  - *Tiles swap:* rebuild with `VITE_TILES_STYLE_URL=<MapTiler/other style URL>` — zero
    code change (the URL is read in exactly one place, `LiveMap.tsx`). The e2e build
    proves the swap by pointing it at the offline `public/dev-style.json`.
  - *Lighthouse PWA:* `pnpm --filter @orbetra/web build && pnpm --filter @orbetra/web preview`,
    open Chrome DevTools → Lighthouse → check "installable" (manifest + registered SW;
    also asserted by the e2e PWA test).
