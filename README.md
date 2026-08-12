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
| `packages/shared` | zod schemas — single source of types; also the branded transactional email shell |
| `packages/registry` | the Redis device-registry contract (`registry:imei`, `device:tenant`/`account`/`config`, the per-tenant index). ONE owner, two writers: device CRUD in the api, billing suspension in the worker |
| `tools/simulator` | device emulator (scenarios per PROJECT_PLAN §7.2) |
| `apps/site` | public marketing site (Lovable design → static Vite SPA, W9-S1) |
| `tools/replay` | real-log replayer for load tests |
| `tools/seed-demo` | demo tenant provisioner for sales calls (`pnpm seed:demo`, E08-5) |
| `tools/redact` | strips real IMEIs from captures before they become fixtures |

## Environment variables

Every new variable must be added to the table here AND match the `.env` contract
(PROJECT_PLAN §6.7).

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | packages/db (`make migrate`, Prisma, raw SQL pool) | PostgreSQL 16 + TimescaleDB + PostGIS connection string |
| `REDIS_URL` | apps/ingest + apps/worker + apps/api | Redis connection (streams + registry + BullMQ), default `redis://127.0.0.1:6379` |
| `INGEST_TCP_PORT` | apps/ingest | Teltonika TCP listener port, default `5027` |
| `INGEST_UDP_PORT` | apps/ingest | Teltonika UDP channel port, default = TCP port; `0` disables UDP |
| `INGEST_UDP_MAX_DGRAMS_PER_IP_PER_MIN` | apps/ingest | Per-IP UDP datagram flood cap, default `6000` |
| `INGEST_UDP_MAX_DGRAMS_PER_SEC` | apps/ingest | Global UDP datagram rate cap across all sources, default `50000` |
| `INGEST_MAX_CONN` | apps/ingest | Total concurrent connection cap, default `20000` |
| `INGEST_MAX_CONN_PER_IP` | apps/ingest | Per-IP connection cap, default `200` |
| `INGEST_PUBLIC_HOST` | apps/api | Public ingest host shown to devices in onboarding config (paired with `INGEST_TCP_PORT`). **No default** — unset ⇒ the onboarding sheet renders the host as a visible gap and `POST /v1/devices/:id/sms` answers 503. Deliberate: a fallback would point a reseller's customer's hardware at *our* domain, written permanently into the device |
| `PROMETHEUS_PORT` | apps/ingest (9101), apps/worker (9102) | /metrics exposition port |
| `EXPORT_DIR` | apps/worker | GDPR export output directory (E08-4), default `var/exports`; R2/S3 upload is the follow-up when creds exist |
| `WEBHOOK_DELIVERY_RETENTION_DAYS` | apps/worker | Days to keep webhook delivery-log rows before the daily retention sweep prunes them, default `30` |
| `RAW_REJECT_RETENTION_DAYS` | apps/worker | Days to keep `raw_rejects` rows, default `90`. A per-minute job drains §3.6 sanity rejections from the `rejects` Redis stream into that table so support can name the offending device instead of reading one global counter (metric `rejects_drained_total`); the raw bytes embed coordinates, so they are pruned by the same daily sweep and erased by GDPR device-erase (which matches on IMEI) |
| `SMTP_HOST` / `SMTP_PORT` | apps/worker | SES SMTP endpoint `email-smtp.eu-central-1.amazonaws.com` / `587` (E05-5, ADR-023); discrete vars, not a URL (SES passwords are base64 — `/` breaks URL parsing) |
| `SMTP_USER` / `SMTP_PASS` | apps/worker | SES SMTP credentials (paste raw, no encoding); all four SMTP vars + `MAIL_FROM` required or the email channel is skipped |
| `MAIL_FROM` | apps/worker | e-mail sender, a DKIM-verified SES identity (e.g. `alerts@orbetra.com`) |
| `SES_CONFIG_SET` | apps/worker | optional SES configuration set → `X-SES-CONFIGURATION-SET` header, routes bounces/complaints to SNS |
| `TWILIO_ACCOUNT_SID` | apps/worker + apps/api | Twilio account SID for the SMS gateway (ADR-032); worker sends config SMS, api reads it to compute `smsConfigured`. All three `TWILIO_*` absent ⇒ SMS channel disabled, send route 503s, web button hidden |
| `TWILIO_AUTH_TOKEN` | apps/worker + apps/api | Twilio auth token (ADR-032); HTTP Basic auth with the SID over native fetch, no `twilio` SDK. Server `.env` only, never git (rule 12) |
| `TWILIO_FROM` | apps/worker + apps/api | Twilio sender phone number (E.164, e.g. `+3706…`) for outbound config SMS (ADR-032) |
| `VAPID_PUBLIC_KEY` | apps/worker + apps/api | Web Push VAPID public key (ADR-026); the worker signs pushes, the api serves it to the browser. All VAPID vars absent ⇒ webpush channel skipped |
| `VAPID_PRIVATE_KEY` | apps/worker | Web Push VAPID private key (ADR-026); server `.env` only, never git (rule 12) |
| `VAPID_SUBJECT` | apps/worker | Web Push VAPID subject (`mailto:`/URL), default `mailto:ops@orbetra.com` |
| `STRIPE_SECRET_KEY` | apps/api | Stripe secret key (`sk_test_`/`sk_live_`); all three STRIPE vars required or billing routes report not-configured (ADR-024). Server `.env` only, never git |
| `STRIPE_WEBHOOK_SECRET` | apps/api | Stripe webhook signing secret (`whsec_…`); verifies `POST /v1/webhooks/stripe` — invalid signature ⇒ 400, no state change |
| `STRIPE_PRICES` | apps/api | comma-separated allowlist of subscribable BASE price ids (`price_…`); a checkout may target only one of these. Two-track catalog per PRICING_STRATEGY.md §7 (Direct flat tiers + TSP base) |
| `STRIPE_OVERAGE_MAP` | apps/api | `basePriceId:overagePriceId,…` — TSP base plans get the metered overage price added as a 2nd checkout line item (Direct plans omit) |
| `STRIPE_PLAN_MAP` | apps/api | `basePriceId:plan,…` — maps each BASE price to the entitlement tier (`TenantPlan`, e.g. `price_direct10:direct_10,price_tspstart:tsp_start`); the signature-verified webhook writes it as the tenant plan. Values that aren't a real `TenantPlan` are dropped (never written) |
| `STRIPE_INCLUDED` | apps/worker | `basePriceId:count,…` — included device count per TSP plan; the daily reporter bills devices beyond it |
| `STRIPE_METER_EVENT` | apps/worker | Stripe meter event name for overage; default `orbetra_device_overage` |
| `STRIPE_BACKFILL_DAYS` | apps/worker | trailing UTC days the overage reporter re-checks each run, submitting only the delta against `usage_reports`; default `3`, clamped 1–14. Raise it if devices routinely buffer for longer than that |
| `BILLING_EVENT_RETENTION_DAYS` | apps/worker | how long applied Stripe event ids are kept for webhook redelivery suppression; default `90`, floored at `7`. Its OWN knob — sharing `RAW_REJECT_RETENTION_DAYS` would let a privacy-motivated shortening prune inside Stripe's ~3-day retry horizon and reopen redelivery |
| `LOCATION_RETENTION_DAYS` | apps/worker | days before DERIVED location data is cleared, default `396` (13 months) — must track the `positions` hypertable policy and the 13 months the privacy policy, Terms and DPA all state. `events` rows are DELETED; `trips` keep the row but have `startLat/startLon/endLat/endLon` nulled, so distance/duration/driver survive for historical reports and mileage claims while the coordinates do not. Floored at 30 days |
| `RETENTION_CONFIRM_SHORT` | apps/worker | set to `1` to allow a `LOCATION_RETENTION_DAYS` BELOW the published 13 months. Without it the worker refuses to start: the sweep is irreversible and unattended, and 13 months is what the privacy policy, Terms and DPA all state, so a shorter window is a legal-position change rather than a tuning knob |
| `TOKEN_RETENTION_DAYS` | apps/worker | days before DEAD auth tokens are deleted, default `30`. Covers `refresh_tokens` (revoked/rotated/expired), `password_reset_tokens` and `affiliate_password_tokens`; a row is only removed once it is also past its own `expiresAt`, so nothing live is ever touched |
| `UNVERIFIED_SIGNUP_RETENTION_DAYS` | apps/worker | days before a NEVER-ACTIVATED self-serve signup (tenant + its unverified users) is deleted; default `30`, floored at `2` because the activation link itself lives 48 h. Only tenants with no verified user, no devices and no commissions are ever touched |
| `PG_POOL_MAX` | apps/api, apps/worker | raw-SQL pool size. Default 10 for the API; the worker asks for 24 because ONE pool there serves 16 shard consumers plus a dozen BullMQ workers |
| `PG_ACQUIRE_TIMEOUT_MS` | apps/api, apps/worker | ms to wait for a free connection before the acquire FAILS, default `10000`. Unset, node-postgres queues an acquire forever with no error and no metric — pool exhaustion looked exactly like a slow database |
| `PG_STATEMENT_TIMEOUT_MS` | apps/api, apps/worker | server-side `statement_timeout`, default `120000`; `0` disables it. Stops one pathological query pinning a pooled connection indefinitely. Watch `pg_pool_connections{state="waiting"}` |
| `BILLING_GRACE_DAYS` | apps/worker | days after a subscription lapses (or a trial expires) before the notice ladder starts; default `14`. Then: grace-end → warning, +1 day → warning, +2 days → final warning, **+3 days → the fleet is SUSPENDED** (its devices leave the ingest registry, so new data is refused). Suspension deletes nothing — the customer can still sign in, read and export everything — and a payment restores the feed within one webhook. Enforcement requires `APP_BASE_URL` **and** a working mail transport: without either the sweep only COUNTS, because cutting a fleet off with no email first is worse than another day of unpaid storage |
| `APP_BASE_URL` | apps/api, apps/worker | absolute base for Checkout/portal return URLs AND the password-reset link (ADR-031) (e.g. `https://app.orbetra.com`); falls back to the request Origin for Stripe. Unset ⇒ forgot-password still 200s but sends no email (link can't be built). **apps/worker needs it too**: without it the billing lapse ladder cannot build a renew link, so it silently degrades to counting and NOBODY is ever suspended |
| `SITE_BASE_URL` | apps/api | absolute origin of the PUBLIC marketing site (e.g. `https://orbetra.com`) — where a partner's short link `/r/<code>` sends a visitor, with `?ref=` attached. Unset ⇒ `/r/<code>` 404s rather than guessing a host, so partner click counts stay at zero and the referral link in the portal leads nowhere |
| `REDIS_COMMAND_TIMEOUT_MS` | apps/ingest | how long a Redis command may hang before it rejects (default 5000). Ingest runs with `enableOfflineQueue: false`, so a disconnected Redis rejects immediately and the socket is destroyed without an ACK (devices buffer and re-send); this covers the other half — a connection that looks healthy but has stopped answering |
| `PARTNER_OPS_EMAIL` | apps/api | where a partner's "request payout" lands (e.g. `hello@orbetra.com`). Unset ⇒ the request is still logged and returned OK to the partner, but **nobody is told** — set it before inviting partners |
| `PARTNER_REDEEM_MAX` | apps/api | set-password redeem attempts per IP per hour (default 30). Raise temporarily when onboarding many partners from one office |
| `OSRM_URL` | apps/api | self-hosted OSRM base URL for route optimization (ADR-029), e.g. `http://osrm:5000`; unset ⇒ `POST /v1/routing/optimize` answers 503. Prep the data volume first (`infra/osrm/README.md`) |
| `TELEGRAM_BOT_TOKEN` | apps/worker + infra/alertmanager | notification delivery (E05-5) AND ops alerts (W7-S1); unset = alerts visible in UI only, no push |
| `TELEGRAM_ALERT_CHAT_ID` | infra/alertmanager | founders' chat id for ops alerts (W7-S1) |
| pgBackRest repo | infra/pgbackrest/pgbackrest.conf | local volume now; swap to Hetzner Storage Box SFTP for real DR (W7-S2, founder-gated) |
| `ORBETRA_SITE_HOST` / `ORBETRA_SITE_WWW` | infra/caddy/Caddyfile | public site apex + www hosts (W9-S1); www 301s to apex; unset = inert |
| `ORBETRA_APP_HOST` | infra/caddy/Caddyfile | dashboard host (dash.<domain>) for the app SPA |
| `PLATFORM_DOMAIN` | apps/api | our own domain (`orbetra.com`). Lets a tenant claim `<slug>.<domain>` as a white-label host with NO DNS work — created already verified, since we hold the zone. **Requires a `*.<domain>` A record**; unset ⇒ the option is not offered and every domain goes through DNS TXT |
| `EDGE_HOSTNAME` | apps/api | where a tenant CNAMEs their OWN domain (`dash.orbetra.com`). Shown in the Domains card — a hostname, not an IP, so the address stays ours to change |
| `VITE_SITE_URL` | apps/web (build) | marketing site the pre-auth pages link back to; default `https://orbetra.com`. Never rendered on a tenant's custom domain |
| `EMAIL_LOGO_URL` | apps/worker | public https URL of OUR logo for mail that is not white-labelled (`https://orbetra.com/email-logo.png`, served by apps/site). Unset ⇒ the header stays the product name as text — a broken image is worse than none on the line that says who sent this |
| `VITE_DASH_URL` | apps/site (build-time) | dashboard URL the site's Sign-in links point to, default `https://dash.orbetra.com` |
| `VITE_DEMO_URL` | apps/site (build-time) | where "Live demo" points; default `/app` (built-in read-only mock admin). An `https://` value links out instead |
| `API_PROXY_TARGET` | apps/site + apps/web vite dev/preview | where the `/v1` proxy forwards, default `http://localhost:3010` |
| `VITE_TILES_STYLE_URL` | apps/site (build-time) | MapLibre style URL, default Carto `dark-matter` (free CDN style; the Lovable v2 design needs a dark basemap — rule 13 still bans paid geo APIs) |
| `API_PORT` | apps/api | HTTP+WS port, default `3010` |
| `JWT_SECRET` | apps/api | HS256 access-token secret, **required**, min 32 chars |
| `JWT_TTL` | apps/api | Access-token TTL seconds, default `900` (15 min) |
| `REFRESH_TTL` | apps/api | Refresh-token TTL seconds (sliding), default `1209600` (14 d) |
| `RESET_TOKEN_TTL` | apps/api | Password-reset link lifetime seconds (ADR-031), default `3600` (1 h) |
| `LOCKOUT_MAX_FAILS` / `LOCKOUT_WINDOW_S` | apps/api | Login lockout per (IP, email) (§6.1), defaults `5` / `900` |
| `LOCKOUT_MAX_FAILS_PER_IP` | apps/api | **Soft** per-IP ceiling on FAILED logins in the window, default `50`. Past it, a source no successful login has ever come from is **throttled to one attempt in ten, before argon2** (never refused outright — the failures are not per-account, so cheap guesses at invented addresses would otherwise lock a whole shared egress with no way back, since the login that clears it is the one being refused). A source a real login HAS come from (24 h marker) is not throttled at all. Decays by one per success |
| `LOCKOUT_MAX_ATTEMPTS_PER_IP_HARD` | apps/api | **Hard** per-IP ceiling on ALL login attempts, default `1000`. Applied before argon2 — the CPU shed — and never refunded by a success, or an attacker with one account of their own would hold it at zero |
| `LOCKOUT_MAX_FAIL_IPS_PER_EMAIL` | apps/api | DISTINCT source IPs that may fail against ONE account before it locks for the window, default `30`. This is a real account lockout and a deliberate trade-off: counting attempts instead would let one host deny any named customer, and applying it after the verify would bound nothing at all. Sources are counted per IPv4 address / IPv6 **/64**, so one machine cannot be thirty. Raise it live if a customer is affected |
| `PARTNER_LOCKOUT_MAX_FAILS_PER_IP` / `..._MAX_ATTEMPTS_PER_IP_HARD` / `..._MAX_FAIL_IPS_PER_EMAIL` | apps/api | The same three ceilings for the partner portal (1 h window); each falls back to its built-in default (`60` / `2000` / `30`) |
| `WS_TICKET_TTL` | apps/api | WS `/v1/stream` one-time ticket TTL seconds (§6.7), default `30` |
| `ARGON2_MAX_CONCURRENT` | apps/api | Max concurrent argon2 password hashes (back-pressures login/CPU), default `8` |
| `ARGON2_MAX_WAITING` | apps/api | Max requests QUEUED for an argon2 slot before shedding with 503, default `64` (≈0.9 s of queueing). An unbounded queue turns a flood on any hashing route into a platform-wide login stall |
| `SMTP_TIMEOUT_MS` | apps/worker | Connect / greeting / socket timeout for SMTP, default `10000`. Without a socket bound a half-open connection pins a notify concurrency slot forever and stalls the alert queue |
| `TRIP_ORPHAN_MAX_IDLE_MS` | apps/worker | An open trip whose device has been silent this long is closed by the startup sweep, default `21600000` (6 h). Otherwise `engineHours` bills it to `now()` forever |
| `SHARD_STOP_TIMEOUT_MS` | apps/worker | How long to wait for a consumer's in-flight batch before abandoning its Redis connection, default `15000`. Connections use `maxRetriesPerRequest: null`, so an unbounded wait would make a Redis partition a permanent shard outage |
| `SMS_QUOTA_DEVICE_PER_DAY` / `SMS_QUOTA_TENANT_PER_DAY` / `SMS_QUOTA_GLOBAL_PER_DAY` | apps/api | Config-SMS ceilings, default `5` / `100` / `1000`. Every send is a real billable message from the platform's Twilio sender; the global one is a breaker that 503s SMS for ALL tenants when tripped (alert `SmsQuotaTripped`, reset with `DEL sms:q:global`) |
| `NOTIFY_CONCURRENCY` / `WEBHOOK_CONCURRENCY` | apps/worker | How many notification / webhook jobs run at once, default `8` each (clamped to 1..32; an unparseable value falls back to the default rather than crash-looping the worker at boot). BullMQ's own default is ONE, which makes a single slow SMTP socket or customer endpoint the whole platform's problem — notify carries panic and overspeed |
| `DEVICE_CREATE_MAX_PER_WINDOW` / `DEVICE_CREATE_WINDOW_S` | apps/api | Devices one TENANT may create per window, default `10000` / `3600`. A resource guard, not an anti-squat measure — it bounds a runaway loop driving rows into `devices` (each taking an IMEI hold platform-wide), and is set at twice the whole platform's designed size (PROJECT_PLAN: 5000 devices; the largest single fleet named is 200) so no real onboarding reaches it. Reserve-then-refund, so only creations that succeed are billed (a rejected batch costs nothing); reservations are taken before the work, so concurrent large imports can trip the ceiling having created nothing. Metric `device_create_throttled_total{why}`; clear one tenant with `DEL devcreate:rl:<tenantId>` |
| `WS_MAX_SOCKET_LIFETIME_MS` | apps/api | Hard ceiling on one live WS socket, default `14400000` (4 h). A stream is authorized only at connect, so this is what makes a plan/role change reach an already-open one; clients reconnect automatically |
| `PUBLIC_API_URL` | apps/api | Absolute API base advertised in the generated OpenAPI `servers[]` (`GET /v1/openapi.json`, `/v1/docs`); unset = omitted |
| `COOKIE_SECURE` | apps/api | `0` disables the Secure cookie flag (dev/e2e over http ONLY) |
| `TRUST_PROXY` | apps/api | `1` = trust X-Forwarded-For for lockout + caddy-ask IPs (behind Caddy) |
| `ASK_RATE_MAX` / `ASK_RATE_WINDOW_S` | apps/api | Caddy on-demand-TLS ask throttle per source IP (E03-5), defaults `10` / `60` |
| `ORBETRA_STAGING_HOST` | infra/caddy/Caddyfile | staging plain-HTTP host (e.g. the server IP) for the pre-TLS `http://` block; unset = inert locally |
| `DATABASE_URL` | apps/api (E03-1+) | required — auth reads users/refresh tokens via @orbetra/db |
| `MAPBOX_TOKEN` | apps/api | Mapbox token for the **Optimization API** (route planner, ADR-034). Absent AND `OSRM_URL` absent ⇒ `/v1/routing/optimize` 503s. SECRET — server `.env` only, never git (GitHub push protection blocks Mapbox tokens). Travels as a query parameter, so the request URL must never be logged |
| `OSRM_URL` | apps/api | Self-hosted OSRM base URL — the ALTERNATIVE routing driver, for the >12-stop case Mapbox cannot serve (ADR-034). Ignored when `MAPBOX_TOKEN` is set |
| `VITE_MAPBOX_TOKEN` | apps/web (build-time) | Mapbox public `pk.` token (ADR-030). NOT in git (GitHub secret-scanning blocks Mapbox tokens): create untracked `apps/web/.env` locally; staging receives it via rsync. |
| `VITE_MAPBOX_STYLE_DARK` | apps/web (build-time) | Map style for the dark theme, default `mapbox://styles/mapbox/dark-v11` (e2e points it at the offline `dev-style.json`) |
| `VITE_MAPBOX_STYLE_LIGHT` | apps/web (build-time) | Map style for the light theme, default `mapbox://styles/mapbox/light-v11` |
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

- `pnpm db:seed:profiles` seeds **109** device profiles — one per Teltonika model with an AVL page
  (105) plus the four pre-catalogue family rows (fmb1xx, fmc, fmb6xx-stub, tat-asset), which are
  kept because live devices reference them and hidden from the picker. `make migrate` runs it: the
  migration marks those four `legacy`, and until the seed lands `GET /v1/profiles` is empty and no
  device can be created. Create devices via the web Devices page or `POST /v1/devices`; each
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
  coarse global bound. The on-demand-TLS `https://` site block in `infra/caddy/Caddyfile` becomes
  active whenever Caddy publishes `:443` (the staging/prod compose does; the local infra-only
  compose maps `:443`→`8449` and has no real DNS, so it stays inert); certs are then minted
  automatically on the first HTTPS hit to a verified domain. Full 2-domain TLS is exercised on
  staging.
- **Two ways to be reachable.** `<slug>.orbetra.com` (`PLATFORM_DOMAIN`) is the zero-setup
  option: we own the zone, so there is no ownership to prove — the domain is created already
  verified and works within seconds, gated only by a reserved-label list (`dash`, `www`,
  `secure`, `login`, `mail`, … — see `checkPlatformSubdomain`) and the same global
  partial-unique index. It needs a `*.orbetra.com` A record to exist; without one, unset
  `PLATFORM_DOMAIN` and the option is not offered. A tenant's OWN domain proves ownership by
  DNS TXT and must then be pointed at us with a CNAME to `EDGE_HOSTNAME` — that second step is
  shown in the Domains card, because proving ownership and routing traffic are different things
  and a verified badge above a domain that resolves nowhere is the worse failure.
- **Pre-login branding**: public `GET /v1/branding` resolves the tenant by `Host`
  (`X-Forwarded-Host` behind Caddy) → verified domain → branding. `AuthShell` (login, forgot,
  reset, activate) reads it before anything renders, so a custom-domain login page shows the
  tenant's logo, colours, tab title and favicon — and shows NO Orbetra wordmark and no link to
  orbetra.com. On our own hosts the inverse holds: the wordmark and a footer line lead back to
  the marketing site. Unknown host → `{whiteLabel:false}` → the platform brand; a FAILED lookup is neither (the client renders nothing rather than guessing ours).
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
  `trips_opened_total`, `trips_closed_total` (counted only when a row was actually written),
  `trip_close_missed_total` (a close that matched no open row — never normal),
  `trip_odometer_rejected_total` (an odometer delta the distance column cannot hold; the GPS
  distance was stored instead).
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

## Fuel level graph (E08-3, §4 "where AVL present")

- Fuel AVL ids are stored under **forced `io_<id>` keys** by the worker (48 = OBD %, 84 = liters
  ×0.1, 89 = %) — 84 and 89 share the dictionary name "Fuel level", so name-keyed attrs would be
  unit-ambiguous ([FMB120 sending params](https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID)).
- `GET /v1/devices/:id/fuel?from&to&limit` (device-scope gated, raw SQL like positions) returns
  `{fixTime, pct, liters}` samples — % from 89 (or OBD 48), liters from 84 with the wiki ×0.1
  applied at read; garbage attrs values are skipped, never 500.
- Playback shows an SVG **fuel line** below the speed chart **only when the device reports fuel**
  (AVL-gated; % preferred over liters). Display only — fuel-theft detection is V2 by §4.

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

## The model decides the dictionary (AVL tables)

- A device profile carries an **`avlTable`** — the generated dictionary that names and signs that
  model's IO elements (`packages/codec/dictionaries/<table>.json`, 105 models → 34 tables, built
  from the Teltonika wiki by `tools/avl-dict`). It rides the **same `device:config` key** as the
  trip config above, written by the one `deviceConfigValue` helper, and the worker resolves it per
  batch through a cache with the same ≈60 s TTL.
- **Picking the wrong model is not cosmetic.** The dictionary decides both the NAME and the SIGN of
  every IO element, and the result is written durably into `positions.attrs` where nothing
  recomputes it. AVL id 141 is 2 bytes either way: "Driver 1 Cumulative Break Time" (Unsigned) on
  the FMB120 table, "Battery Temperature" (Signed) on the FMx6xx tables — so the same reading is
  65535 minutes or −0.1 °C. Correcting a profile relabels **future** positions only; rows already
  written keep the names they were decoded with.
- **Fallback** is `fmb120` (the table 45 models render identically) whenever the answer is
  unavailable: no config row yet, a config written before the field existed, a malformed value, an
  unknown table name, or Redis unreachable. Every one of those increments
  `pipeline_avl_table_unresolved_total{reason}` (alert `AvlTableUnresolved`) — a non-zero rate means
  devices are being decoded with the wrong dictionary, which looks like data, not like an error. It
  counts device→table RESOLUTIONS, which are cached for ~60 s, so read it as "how many devices", not
  "how many positions" — except `redis_error`, which is deliberately not cached so the next batch
  retries, and therefore repeats per batch for as long as the outage lasts.
- Elements the table does not name (and ids whose name is ambiguous **within** a table, where two
  parameters share a name) surface as `io_<id>`. That is deliberate: resolving a name collision by
  arrival order would label a percentage and a kilogram count identically.
- **KNOWN GAP — the read path is still model-blind.** The decoder now uses each device's own
  dictionary; the code that READS `positions.attrs` does not. Most of the vocabulary is stable —
  1593 of the 2194 ids that appear on more than one table carry one name everywhere — but the ids
  our readers key on are disproportionately the CAN and fuel ones Teltonika reuses, and of those 18
  only id 67 (Battery Voltage) is constant. Id 85 is "Engine RPM" on some tables and "Engine
  Current Load" on others; 32 is "Coolant Temperature" or "Axle 5 Load"; 89 is "Fuel Level" or
  "Axle weight 1"; 236 is "Alarm" or "Axis X". So on FMx6xx and the FTC/ATC families the CAN and fuel panels can read the
  wrong parameter or nothing at all, and a panic / power-cut rule may be impossible on a model whose
  table has no such element. Ids whose meaning is CONSTANT and only spelled differently (21 GSM, 66
  external voltage, 78 iButton) are handled. The rest needs a per-table semantic index — which is
  the same work as the dictionary-driven renderer below, and is not in this change.
- Regenerate with `pnpm --filter @orbetra/avl-dict gen` (`--fresh` refetches; `--coverage` diffs
  `models.json` against the wiki's own page index). The JSON is generated — never hand-edit it.

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

## Codec 12 commands (E08-2)

- **Send** a GPRS command to a live device: `POST /v1/devices/:id/commands {text}` (device-
  scope-gated; hardware control → `ACCOUNT_WRITERS`; a retired device is 400). It creates a
  `queued` `Command` (24 h expiry, §3.5) and queues it on the Redis transport seam.
- **Transport** — `apps/ingest` (rule 3: transport only) LPOPs `cmd:pending:{deviceId}` after
  the handshake + after each frame, writes `encodeCodec12(text)` to the socket, and records it
  `cmd:inflight`; device responses are captured to `cmd:resp` (existing).
- **Policy** — the worker dispatcher (~15 s) reconciles in-flight ↔ responses **in FIFO order**
  (the device answers sequentially, §3.5) and drives the DB status machine
  `queued→sent→acked|failed|expired`: a response acks (nack → failed), a 30 s timeout retries
  (max 3) then fails, and `expiresAt` past 24 h expires. Metric `commands_resolved_total{outcome}`.
- **Status** — `GET /v1/commands/:id` and `GET /v1/devices/:id/commands`. The 10 presets
  (`getinfo`, `getver`, `getgps`, `getio`, `cpureset`, dout on/off, reporting-interval,
  server-address, `deleterecords`) are in `@orbetra/shared`.
- **Web** (E08-2b) — Devices page → per-row **Commands** opens the device panel: the 10 preset
  buttons + free-text (printable ASCII, ≤512), command history with status badges + response,
  polled every 5 s while anything is queued/sent. Destructive commands (`cpureset`,
  `deleterecords`) are two-step: the first click arms a danger confirm, the second sends;
  editing the text or switching preset disarms.

## Public site (W9-S1, apps/site)

Static Vite SPA ported from the founder's Lovable design (the `orbetra_*` export dirs stay the
design source and are gitignored; syncs are manual with review — ADR-022/ADR-033). Served as
**orbetra.com** behind Caddy (`ORBETRA_SITE_HOST`/`ORBETRA_SITE_WWW`; the product app lives at
**dash.orbetra.com**, `ORBETRA_APP_HOST`).

Pages: home, pricing (Direct + TSP tracks), `/tsp` (reseller track), `/pilot`, `/signup`,
`/login` (a chooser — the site never authenticates tenant users), `/demo`, `/docs`, `/cookies`,
`/partners` + the partner portal (`/partner/login`, `/partner/set-password`,
`/partner/dashboard`), the legal pack (terms/privacy/DPA/subprocessors/impressum), and a
read-only mock-admin demo under `/app/*` (pure client-side fixtures, no API).

Public endpoints it calls:
- `POST /v1/public/pilot-request` — the pilot/partner-application form (honeypot + 5/h per-IP,
  fails OPEN on a Redis blip: a lost lead is unrecoverable).
- `POST /v1/public/signup` — self-serve trial: creates a tenant + account + tenant-admin user on
  `direct_10`, `trialing` for 30 days (the length promised in the Terms). Honeypot + per-IP limit
  + a platform-wide circuit breaker, and it FAILS CLOSED (503) if Redis is down — unlike a lead, a
  signup is retryable, and this endpoint creates real tenants. No session is minted; the user signs
  in through the normal login.
- `POST /v1/partner/{login,set-password}` + `GET /v1/partner/{me,commissions}` — the partner
  portal (separate `typ:'partner'` token, held in memory only).

The affiliate `?ref=` code is stored as the `tc_ref` cookie (60 d) only after consent (cookie
banner) and rides along in the signup/lead payload (§6.9 last-touch). The site ships **EN/PL/DE/LT**
with a working language switcher; legal pages and the mock-admin demo stay English.

## Demo data (E08-5, `pnpm seed:demo`)

Provisions the **Demo Logistics** tenant for sales calls against a RUNNING stack
(`make up` + ingest + worker + api, or staging env vars): 2 accounts, 3 users
(`demo-admin@orbetra.test` + manager + viewer; password printed, or set `DEMO_PASSWORD`),
12 devices with 3 days of drive history pushed **through the real pipeline** (simulator →
ingest TCP → worker), a geofence, overspeed + panic rules, one panic event and one
invalid-fix trail gap for the playback demo. Drives end with an ignition-off park tail so
trips CLOSE; rules/geofences are synced to the worker's Redis caches so events actually
fire. Idempotent for rows (demo users' password is re-stamped so the printed one always
works); history is sent only when devices were newly created (`--with-history` to
re-drive). Guards: any non-loopback DB/ingest target requires `SEED_DEMO_ALLOW=1` (or
`--yes`); `NODE_ENV=production` additionally requires `--force`. Synthetic 867… IMEIs
only (rule 12). Env: `DATABASE_URL` (required), `REDIS_URL`, `INGEST_HOST`/`INGEST_PORT`.

## GDPR (E08-4): retention · device-delete cascade · account export

- **Retention** is PLATFORM-WIDE by design (§6.3, R8-3): `add_retention_policy('positions',
  13 months)` — chunks are time-partitioned across ALL tenants, so per-tenant retention
  cannot drop chunks. Shorter per-tenant retention = a V2 delete-by-device job (plan-normative).
- **Device erase** (`POST /v1/devices/:id/erase`, TENANT admins, retired devices only —
  retire already tears down ingest, so no new data races the delete): a BullMQ job deletes
  positions (30-day windows), trips, events, commands and Redis state, then the device row
  LAST (crash-retry marker). Deliberately kept: `usage_daily` (billing, legitimate interest)
  and `audit_log` (append-only evidence; redaction V2). Metric `gdpr_erase_total`.
- **Account export** (`POST /v1/accounts/:id/export`, §6.6): a BullMQ job streams ONE
  NDJSON.gz (account, users **without passwordHash**, devices, trips, events, commands,
  geofences, rules, webhooks **without secret** — every unbounded table keyset-paged, gzip
  backpressure honoured, temp-file + atomic rename) to `EXPORT_DIR`; `GET /v1/exports/:id`
  polls status, `/download` streams it (scoped, 410 + unlink after the 7-day expiry; an
  hourly worker sweep removes expired files durably). A pending export per account is
  coalesced. Web: Settings → Data export (admins) + Erase on retired devices.
- **Erase timing**: allowed only ≥60 min after retire (409 earlier). Three belts close the
  resurrection window completely: (1) **ingest re-checks the registry on every data frame**
  — a de-registered device's live session dies on its next frame, unACKed (covers long
  read-idle profiles like tat-asset's 26 h and never-silent sessions); (2) the 60-min guard
  outlives the stream backlog; (3) the worker runs a final post-delete sweep. Kept by
  design: `usage_daily`, `audit_log`, `webhook_deliveries` (no location PII); tenant-shared
  (account-null) geofences/webhooks are not part of an account's export.

## Usage metering + platform panel (E07-4)

- **Metering** — an hourly worker sweep derives billable **device-days** from **positions**
  (the authoritative record — a last-fix snapshot would lose days, e.g. a trip crossing UTC
  midnight): every UTC day a device has ≥1 position (invalid fixes count — presence, §3.4)
  gets one `usage_daily` row, scoped via the devices table. `PK (deviceId, day)` +
  `ON CONFLICT DO NOTHING` → a day is counted **once**; the 48 h lookback also backfills
  worker outages (longer gaps: run the sweep with a wider lookback at month-close). UTC on
  purpose: billing periods must be timezone-stable (§6.9). Metrics `usage_device_days_total`
  + `usage_sweep_failed_total` (a stalled metering pipeline is silent under-billing).
- **API** — `GET /v1/platform/usage?from&to` (platform_admin: per-tenant device-days +
  distinct active devices) and `GET /v1/usage?from&to` (tenant admins: own per-day counts).
- **Web** — `/app/platform` (nav Admin → Platform, **platform_admin only**): tenants with
  this month's device-days + active devices (the month-close billing input, §6.9).

## Security headers (E07-5)

- Every API response (incl. 401/404 and the public docs) carries `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`,
  and a minimal `Permissions-Policy`. **HSTS** (180 d) is sent only in TLS deployments
  (`ApiDeps.hsts`, defaults to `secureCookies`) — dev/e2e over plain http never advertises it.
  The Caddy edge sets the same set for the SPA (defense in depth) and drops the `Server`
  banner. No global CSP yet (the self-contained `/v1/docs` inline script needs a nonce first)
  — see `docs/audit/security-pass-2026-07.md` for the full W7 S5 audit (rate limits, deps,
  secrets, argon2, WS auth).

## API docs / OpenAPI (E06-5)

- **`GET /v1/openapi.json`** — an OpenAPI 3.1 document for the public API, **generated from
  the route manifest** (so it can't drift from the live routes) plus the curated non-manifest
  routes (auth, reports, api-keys). Two security schemes — `bearerAuth` (JWT) and `apiKeyAuth`
  (X-Api-Key); GET operations accept either, writes require the JWT. Import it into Postman /
  your client, or view **`GET /v1/docs`** — a self-contained, dependency-free HTML page (no
  external CDN/resources) that lists the endpoints grouped by tag. Both are public (before the
  auth guard). A richer Scalar/Stoplight embed can replace the renderer later (needs a bundle
  ADR).

## Webhook delivery (E06-4)

- **Worker** — every persisted event (rule / geofence / device_offline) is enqueued and the
  webhook worker POSTs it to the event account's enabled webhooks that subscribe to the kind
  (empty `events[]` = all kinds; tenant-shared webhooks with a null account also match).
- Each delivery carries **`X-Signature: sha256=<hmac>`** = HMAC-SHA256 of the exact body with
  the webhook's secret (§6.5), so the receiver verifies authenticity + integrity. **Retry is
  BullMQ's** (`attempts: 5`, exp backoff); a per-job Redis sent-set gives **per-endpoint
  idempotency** (a retry re-POSTs only the endpoints that failed) keyed by a stable
  `X-Webhook-Id`. Metrics `webhook_delivered_total` / `webhook_failed_total`.
- **SSRF-guarded**: the target URL is re-resolved at request time and rejected if it maps to
  a loopback/link-local/private/ULA/metadata address (defeats DNS rebinding), only http(s) is
  allowed, redirects are refused (`redirect: 'error'`), and each POST has a 10 s timeout so a
  hanging endpoint can't pin worker concurrency.
- **Delivery log (E06-4b)** — the worker records one `webhook_deliveries` row per POST attempt
  (endpoint id, event id/kind, HTTP status, success, short error — never the payload/secret),
  read-only over `GET /v1/webhook-deliveries` and shown as a "Recent deliveries" table on the
  webhooks page. Retention pruning is W7.
- **Web** `/app/webhooks` (nav Admin → Webhooks, admin-only) — register an endpoint URL +
  event-kind filter; the signing **secret** is generated client-side and shown **once** (it
  is redacted `***` in every list/get — the API never returns a stored secret). Toggle
  enabled / delete.

## API keys + public REST (E06-3)

- **Auth** — integrations send `X-Api-Key: orb_live_…` instead of a Bearer JWT on the same
  `/v1/*` routes (§6.6). The key is SHA-256'd and looked up; a match resolves to a
  **read-only** context (role `viewer`) — key holders can GET and run reports but never
  mutate (writes 403). The full key is shown **once** at creation; only its hash + a display
  prefix are stored.
- **Rate limit** — per-key fixed 60 s window in Redis (`apikey:rl:{id}:{minute}`), default
  **600/min** (`apiKeyRateLimitPerMin`); over budget → `429`.
- **Management** — `POST/GET/DELETE /v1/api-keys` (**tenant-admin only** — an API key can't
  mint keys). Dedicated routes, EXEMPT from the manifest with dedicated isolation tests. The
  **web** exposes this at `/app/api-keys` (nav Admin → API keys, admin-only): create a key
  (the plaintext is shown **once** to copy), list keys with last-used + status, and revoke.

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
- **Email is LIVE-capable** (SES production access approved 2026-07-14, ADR-023): set
  `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS` + `MAIL_FROM` on the worker (see
  docs/runbooks/aws-ses-setup.md) and email alerts send.
  **Telegram still gated** on `TELEGRAM_BOT_TOKEN` (+ the pairing deep-link that binds a `chat_id`).
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
  - *Style swap (ADR-030):* rebuild with `VITE_MAPBOX_STYLE_DARK/_LIGHT=<style URL>` — zero
    code change (the style/token are read in exactly one place, `src/lib/map.ts`). The e2e
    build proves the swap by pointing both at the offline `public/dev-style.json`.
  - *Lighthouse PWA:* `pnpm --filter @orbetra/web build && pnpm --filter @orbetra/web preview`,
    open Chrome DevTools → Lighthouse → check "installable" (manifest + registered SW;
    also asserted by the e2e PWA test).
