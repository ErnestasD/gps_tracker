# E01-3 Plan — DB layer: Prisma schema + SQL migrator + hypertable (M)

**Story:** IMPLEMENTATION_PLAN.md E01-3 · **Implements:** PROJECT_PLAN §6.3 (DDL verbatim)
**Status:** in progress

## Ambiguity note (flagged, not blocking)
§6.3 says relational tables "mirror §5.3 of v1 plan" — the v1 plan is NOT in the repo.
Column-level design is therefore derived from every field referenced across PROJECT_PLAN
and IMPLEMENTATION_PLAN stories (branding jsonb, presence_rules, account.timezone,
referred_by_affiliate_id, command lifecycle statuses, geofence geography, …). Founder
review of `schema.prisma` = review of this derivation. Migrations are append-only, so
later stories refine by adding migrations, never by rewriting.

## Deliverables
1. `packages/db/prisma/schema.prisma` — 17 models (tenants, tenant_domains, accounts,
   users, device_profiles, devices, raw_rejects, trips, geofences, rules, events,
   commands, api_keys, webhooks, usage_daily, audit_log, geocode_cache);
   `geofences.geom` as `Unsupported("geography(Polygon,4326)")`; `positions` deliberately
   ABSENT from Prisma (CLAUDE.md rule 1).
2. `packages/db/prisma/migrations/0_init/migration.sql` — generated offline via
   `prisma migrate diff --from-empty` (no hand edits); applied with `prisma migrate deploy`.
3. `packages/db/sql/001_positions.sql` — §6.3 DDL verbatim incl. comments (hypertable,
   compression, retention). `packages/db/sql/002_daily_device_stats.sql` — the continuous
   aggregate + policy, marked `-- migrate:no-transaction` (caggs cannot be created inside
   a transaction; the §6.3 block is split across two files for this mechanical reason only,
   byte-content preserved).
4. `packages/db/sql/migrate.ts` — tiny runner: `schema_migrations(name pk, checksum,
   applied_at)`, lexical order, transactional per file unless the no-transaction directive,
   REFUSES to run if an applied file's checksum changed (append-only enforcement).
5. `packages/db/src/pool.ts` — pg Pool factory (the raw-SQL side's only entry).
6. `Makefile migrate` — prisma migrate deploy + sql runner, both against `DATABASE_URL`.
7. **Compressed-chunk verification** (R8-2 audit gate): script + test — insert, compress
   chunk, insert late row of same PK shape into the compressed chunk; outcome recorded in
   `docs/audit/ts-compressed-insert.md` with the pinned image/TS version.

## Tests (testcontainers, image timescale/timescaledb-ha:pg16)
- migrate.spec: empty DB → `make migrate` path (deploy + runner) → tables/policies visible
  in `timescaledb_information.*`; run again → zero diff (idempotent); tampered checksum →
  runner refuses.
- compressed-insert.spec: the R8-2 verification, writes the audit doc content assertion.

## NOT here
Repositories/Scope layer (E03-2), seed data, COPY optimization (needs ADR-008).
