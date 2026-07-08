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
