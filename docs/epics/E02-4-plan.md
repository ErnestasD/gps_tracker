# E02-4 Plan — Live state + WS gateway (M)

**Story:** IMPLEMENTATION_PLAN.md E02-4 · **Implements:** §6.1 live path, §6.6 ws-ticket, R8-6
**Deps:** hono/@hono/node-server/ws/ioredis (ADR-016) · **Status:** shipped with this branch

## Shape
- `apps/worker/src/liveState.ts` — `device:{id}:last` hash, MAX-WINS on fix_time (buffered
  floods never regress the marker; newest-per-device chosen by fixTime even from unsorted
  input); publishes compact JSON to `live:{tenantId}`. Tenant/account mappings come from
  `device:tenant` / `device:account` Redis hashes — synced by E03-3 device CRUD (stub-seeded
  in tests until then). Wired into consumer via onBatch in worker main.
- `apps/api/src/ws.ts` — single-use ws-ticket (SETEX 30 s → GETDEL on upgrade, R8-6);
  `/v1/stream?ticket=` upgrade; per-tenant fanout with server-side account-scope filter.
- `apps/api/src/app.ts` — Hono app: `/healthz`, `GET /v1/ws-ticket` behind a **story-
  sanctioned auth STUB** (single Bearer token → fixed user ctx). E03-1 replaces the stub
  with argon2id+JWT middleware and MUST delete `AuthStub` (explicit removal marker in code).

## AC coverage
- marker moves <2 s after publish ✓ (measured in test)
- bufferedFlood old records do NOT regress `last` ✓
- ticket reuse refused ✓ · expired (>TTL) ticket refused ✓
- account-A user never receives account-B device events (scope test, tenant-wide user
  sees both) ✓
- "simulator send → WS <2 s" full-chain variant lands with E02-6 Playwright smoke
  (simulator→ingest→worker→WS→map); the WS-side latency is proven here.
