# CLAUDE.md — Operating Rules for This Repository

You are building Orbetra: a multi-tenant, white-label GPS tracking platform for Teltonika devices.
The full specification is `PROJECT_PLAN.md` (v2.0). It is normative. When this file and the plan
conflict, the plan wins. When the plan and the Teltonika wiki conflict, **the wiki wins** — flag the
discrepancy in `docs/adr/` and tell the human.

## Golden context (read before any task)
- Spec: `PROJECT_PLAN.md` §3 (protocol), §6 (architecture), §8 (current epic stories + AC)
- Current epic plan: `docs/epics/W<N>.md`
- Protocol truth: https://wiki.teltonika-gps.com/view/Codec and per-model AVL ID pages

## Monorepo map
```
apps/ingest     raw TCP only: framing, handshake, CRC, parse, XADD, ACK. ZERO business logic.
apps/worker     stream consumers (ordered pipeline) + BullMQ jobs (async).
apps/api        Hono REST + WS gateway. Thin: validation, authz, calls packages/db repos.
apps/web        React SPA (Vite, Mapbox GL, TanStack, shadcn) — the dashboard.
apps/site       public marketing SPA (Vite, static; ADR-022/W9-S1) — orbetra.com.
packages/codec  parser wrapper + AVL dictionaries (JSON, with source_url) + golden fixtures.
packages/db     Prisma (relational) + raw SQL layer for positions (batched INSERT ON CONFLICT — NOT COPY) + SCOPED REPOSITORIES (the only DB API).
packages/shared zod schemas — the single source of types for api/web/worker.
tools/simulator device emulator (scenarios: live-drive, buffered-flood, panic, invalid-fix, corrupt-crc, oversize, slow-loris).
tools/replay    real-log replayer for load tests.
```

## Commands
- `pnpm i` · `make up` (local infra) · `turbo run dev --filter=@orbetra/web` (only web/site have a `dev` server; api/ingest/worker run via `tsx`, e.g. `tsx apps/api/src/main.ts`)
- `turbo run typecheck lint test --filter=<pkg>` — run after EVERY edit to that pkg (hook does this too)
- `turbo run test --filter=@orbetra/codec` — golden corpus; `pnpm test:isolation` — tenant isolation suite; `pnpm --filter @orbetra/web e2e` — compose+simulator (Docker)
- DB: `make migrate` — runs `prisma migrate deploy` then `tsx packages/db/sql/migrate.ts` (numbered SQL for hypertable/caggs). Never edit an applied migration.

## Hard rules (violations = do not merge)
1. **No Prisma/ORM on `positions`.** Hot path uses the raw SQL layer in packages/db only: batched multi-row INSERT ... ON CONFLICT DO NOTHING. PostgreSQL COPY does NOT support ON CONFLICT — do not "optimize" to COPY without ADR-008 (staging-table pattern).
2. **No DB access outside packages/db repositories.** Importing `@prisma/client` elsewhere is lint-banned. Every repo method takes an explicit tenant scope.
3. **No business logic in apps/ingest.** It frames, verifies, parses, persists to stream, ACKs. Nothing else.
4. **ACK contract:** reply the 4-byte record count ONLY after XADD returns. On partial parse failure, ACK the count actually persisted.
5. **Ordering:** all per-device processing happens on the device's shard (`imei % 16`). Never process positions for one device concurrently.
6. **Invalid fix:** `satellites == 0` ⇒ `fix_valid=false`. Such records NEVER affect trip distance, geofence state, overspeed, or map trails. They may affect presence and IO events.
7. **Time:** DB stores UTC `timestamptz` only. Formatting with account timezone happens at render, via date-fns-tz. `new Date()` arithmetic without explicit zone handling is banned in report code.
8. **Protocol claims need citations.** Any byte offset, codec detail, or AVL ID in code/comments must reference a wiki URL. If you cannot cite it: stop, insert `// TODO(VERIFY-WIKI): <question>`, and surface it. CI blocks merge on that marker — that is intentional.
9. **Golden fixtures are immutable.** If a fixture seems wrong, you do not edit it; you cite the wiki section proving it wrong and ask the human.
10. **No new runtime dependencies without an ADR.** Dev-deps allowed with justification in PR description.
11. **Migrations are append-only.** New numbered file; never rewrite history.
12. **Secrets never in code or fixtures.** Real IMEIs in captures are redacted by `tools/redact` before commit.
13. **Geo stack (amended 2026-07-17, ADR-030).** Maps = **Mapbox GL JS** with the founder's `pk.` public token via env `VITE_MAPBOX_TOKEN` (never hardcoded and NEVER committed — GitHub push protection blocks Mapbox tokens; it lives in the untracked `apps/web/.env`, see the README env table; URL-restrict the token in the Mapbox dashboard). Styles are theme-reactive via `VITE_MAPBOX_STYLE_DARK`/`VITE_MAPBOX_STYLE_LIGHT` (defaults `mapbox://styles/mapbox/dark-v11`/`light-v11`). Mapbox attribution stays visible on every map view (TOS). Reverse geocoding remains self-hosted Photon (`GEOCODER_URL`); routing remains self-hosted OSRM (ADR-029). Never introduce Google Maps or any OTHER paid geo API without an ADR. History: the original free-stack mandate (MapLibre + OpenFreeMap) was replaced by founder decision; Mapbox free tier is 50k loads/mo — monitor usage.
14. **Scope discipline:** implement the story's AC, nothing more. Features not in PROJECT_PLAN §4 V1-MUST require human approval first (say so, don't build "while you're there").

## Workflow per story
1. Read epic plan + story AC. If AC is ambiguous, ask BEFORE coding — one clarifying question beats a wrong afternoon.
2. Tests first for codec/pipeline/trip-engine stories: name the fixture/scenario you will satisfy.
3. Implement smallest diff that passes AC. Run pkg gates. Update docs (env table, OpenAPI, README) if surface changed.
4. Add/extend metrics when touching the pipeline (`ingest_*`, `pipeline_lag_ms`, `stream_depth`).
5. Self-check against `PROJECT_PLAN.md` §10 failure map — state in the PR which failure modes this story touches and how they're covered.
6. Request the Adversarial Review pass (below) in a FRESH session/subagent. Address findings. Merge.

## Adversarial Review prompt (run by a fresh session on the diff)
"You are a hostile senior reviewer. Given PROJECT_PLAN.md §6 invariants I1–I5, §10 failure map, and CLAUDE.md hard rules,
find concrete violations in this diff: tenant scope leaks, ordering breaks, ACK-before-persist, invalid-fix leakage,
timezone naivety, hot-path ORM, unbounded buffers, missing tests for stated AC. Output: violation | file:line | why | fix.
If you find none, say which invariant you actively tried to break and how the code resisted."

## Definition of Done (every story)
AC met with demonstrable test · typecheck+lint+tests green · isolation suite green (if API/db touched) ·
docs updated · metrics added (if pipeline) · reviewer pass addressed · zero `TODO(VERIFY-WIKI)` markers ·
no fixture edits · no unapproved deps.

## When stuck
Prefer: (a) consult wiki page and cite it; (b) consult Traccar's `TeltonikaProtocolDecoder.java` as oracle (Apache 2.0 — reference logic, do not copy-paste wholesale without attribution comment); (c) write a simulator scenario reproducing the confusion; (d) ask the human with a concrete either/or question. Never guess byte semantics.
