# Security pass — W7 S5 (E07-5), 2026-07-10

Scope per PROJECT_PLAN §8 W7 S5: **headers, rate limits, dependency audit, secrets scan,
argon2 params, WS auth review**. Findings + evidence below; code changes shipped in the same
PR (API security-headers middleware + Caddy edge headers + tests).

## 1. Security response headers — ADDED ✅

Before this pass the API and the edge set **no** security headers.

- **API** (`apps/api/src/security.ts`, registered first in `createApp` so every Hono-served
  response — including 401/404/problem+json, thrown-handler 500s, and the public /v1/docs —
  carries them; the ONE exception is the raw WS-upgrade 401, written directly on the socket
  outside Hono with an empty body — nothing sniffable/embeddable, accepted):
  `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Referrer-Policy: no-referrer`
  · `Cross-Origin-Opener-Policy: same-origin` · `Cross-Origin-Resource-Policy: same-origin` ·
  `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` ·
  `Strict-Transport-Security: max-age=15552000; includeSubDomains` (TLS deployments only —
  `ApiDeps.hsts`, defaults to `secureCookies`; dev/e2e over plain http never advertises HSTS).
- **Edge** (`infra/Caddyfile` https:// block): same set for the SPA/static assets + `-Server`
  (drop the server banner). Defense in depth — both layers set them independently.
- **Deliberately NO global Content-Security-Policy**: every /v1 response is JSON except
  `/v1/docs`, whose self-contained renderer uses an inline `<script>`/`<style>` (documented in
  E06-5). Adding a strict CSP requires a nonce/hash there first. **Follow-up:** CSP with a
  per-response nonce for /v1/docs; a CSP for the SPA belongs at the edge once audited for
  MapLibre blob/worker usage.
- Tests: `apps/api/__tests__/securityHeaders.spec.ts` (present on health/401/docs/404; HSTS
  gating).

## 2. Rate limits — REVIEWED, adequate for v1 ✅ (2 accepted gaps)

| Surface | Mechanism | Status |
|---|---|---|
| `POST /v1/auth/login` | lockout 5 fails → 15 min per **IP+email**, checked BEFORE argon2/DB (attacker CPU cap) | ✅ E03-1 |
| argon2 concurrency | global semaphore `ARGON2_MAX_CONCURRENT=8` (64 MB × 8 cap — OOM guard) | ✅ E03-1 |
| `GET /v1/internal/caddy-ask` | 10/min per IP (Redis INCR) | ✅ E03-5 |
| `X-Api-Key` requests | 600/min per key (`apikey:rl:{id}:{min}`), 429 | ✅ E06-3 |
| WS tickets | 30 s TTL + single-use GETDEL | ✅ E02-4 |
| ingest TCP | `INGEST_MAX_CONN=20000`, `INGEST_MAX_CONN_PER_IP=200`, 4 KiB frame cap, I4 backpressure | ✅ E01/E02 |

**Accepted gaps (documented, not fixed here):**
- *Unauthenticated API-key flood* reaches one DB lookup per request before the per-key limit
  engages (E06-3 review MED). Guessing is infeasible (192-bit keys); the residual risk is DB
  load. Mitigation belongs at the edge (Caddy per-IP rate limit needs the non-standard
  rate-limit plugin → custom build; revisit with W7 S1 infra work) or a Redis negative-cache.
- *`POST /v1/auth/refresh`* has no dedicated throttle: an invalid cookie costs one indexed
  SHA-256 lookup (no argon2), and rotation-theft detection already revokes families.
  Low-value target; acceptable.

## 3. Dependency audit — CLEAN ✅

`pnpm audit` and `pnpm audit --prod` (2026-07-10, lockfile `pnpm-lock.yaml` @ HEAD):
**No known vulnerabilities found.** Runtime dependency surface remains ADR-gated
(CLAUDE.md rule 10); notable runtime deps: hono, prisma/@prisma/client, pg, ioredis, bullmq,
@node-rs/argon2, zod, maplibre-gl, terra-draw, react/tanstack, prom-client, xxhash-wasm.

## 4. Secrets scan — CLEAN ✅

- Pattern scan over `apps packages tools infra` for hardcoded `password/secret/api-key/token`
  literals (excluding tests/seeds/schemas): **no hits**.
- No `.env*` files tracked by git. `.env.example`-style docs live in README env tables only.
- Secrets-at-rest posture: webhook HMAC secrets **redacted (`***`) in API reads** (PR #39
  `readRedact`) and in audit snapshots; API keys stored as **SHA-256 hash + display prefix**
  only (E06-3); user passwords argon2id (below); JWT secret env-only with a ≥32-char runtime
  assertion; real IMEIs redacted by `tools/redact` before commit (rule 12).

## 5. argon2 params — CONFIRMED ✅

`packages/shared/src/auth.ts` `ARGON2ID_PARAMS`: **argon2id, m=65536 KiB (64 MB), t=3, p=4**
— matches the OWASP Password Storage Cheat Sheet first-choice configuration (m≥19 MiB
minimum; we run 64 MB) and the E03-1 story mandate. Single-sourced: `apps/api` hashing and
`packages/db/seed/users.ts` both import the same constant, so parameters cannot drift. The
PHC-string prefix is asserted in tests. Verification failures are constant-shaped (a fake
verify runs on unknown emails so timing does not reveal account existence).

## 6. WS auth review — SOUND ✅

`apps/api/src/ws.ts` (pattern from §5 R8-6, re-verified):
- `GET /v1/ws-ticket` (JWT-authenticated) mints a **random 32-byte** ticket, stored
  `SETEX 30 s` with the caller's auth context.
- The upgrade consumes it with **GETDEL** — single-use, replay-impossible; expired/unknown →
  socket closed. No long-lived JWT ever appears in a URL (failure-map #10).
- Fanout filtering: tenant channel `live:{tenantId}` + in-payload `accountId` check;
  account-scoped users fail CLOSED on unmapped devices (E03-3 review).
- Tickets carry the real user context (role/scope) — revocation of the user does not kill an
  open socket (accepted: access-token TTL 15 min bounds it; W7 soak will observe).

## Verdict

No HIGH-risk findings. Shipped: headers (API + edge, incl. a thrown-500 regression test
pinning Hono compose semantics) + tests. Accepted-and-documented: API-key pre-lookup flood
(edge mitigation later), refresh-endpoint throttle (low value), docs-page CSP nonce
(follow-up), WS socket lifetime vs revocation (bounded), raw WS-upgrade 401 without headers
(empty body), edge/API header duplication on /v1 (identical values; keep both layers in
sync), `Permissions-Policy: geolocation=()` will need loosening if a browser "locate me"
feature ever lands in the SPA.
