# E02-3 Plan — Worker pipeline core (L)

**Story:** IMPLEMENTATION_PLAN.md E02-3 · **Implements:** §6.1 bottom half, invariants I1–I3, Appendix A NormalizedRecord
**Deps:** ioredis/cbor-x/xxhash-wasm + zod in shared (ADR-015) · **Status:** shipped with this branch

## Shape
- `packages/shared/src/records.ts` — RawStreamPayload zod contract (ingest→worker) + NormalizedRecord (Appendix A)
- `shards.ts` — ShardLeaser: Redis TTL leases `shards:lease:{n}` (SET NX PX + renew loop), exclusive ownership, graceful release
- `normalize.ts` — payload → NormalizedRecord: fix_valid=sats>0 (rule 6), AVL 239/240/16 → columns, dictionary-named attrs, unknown → io_<id>, rec_hash = signed xxhash64(raw) (R10)
- `writer.ts` — ONE batched multi-row INSERT…ON CONFLICT DO NOTHING, ≤500 rows (rule 1; COPY forbidden)
- `consumer.ts` — per-shard strictly serial: XAUTOCLAIM(min-idle 60s, on start + 30s) → XREADGROUP ≤200 → normalize (malformed → raw:dead + continue) → fixTime-sort → write → onBatch handoff → XACK-after-insert
- `main.ts` — claim shards, run consumers, SIGTERM: finish batch + XACK + release leases <5s

## AC coverage (14 tests, real ingest server + real simulator + testcontainers redis/timescale)
I1 (acked==stream==rows) ✓ · I2 (flood+live → fixTime-ordered handoff) ✓ · I3 (replay → zero new rows) ✓ ·
chaos crash-before-XACK → XAUTOCLAIM recovery, zero loss/dupes ✓ · SIGTERM <5s ✓ · rec_hash >2^63−1 signed ✓ ·
malformed CBOR → raw:dead ✓ · lease exclusivity ✓.
**Throughput pre-gate (1500 rec/s × 60 s)**: deferred to a PERF=1-gated run before E07-3 —
recorded here as an open AC item, not silently dropped. Ordering honesty (review): serial-per-shard gives per-device ARRIVAL order; fixTime sort is per-batch only — cross-batch late records are reconciled by E04-2 recompute and liveState is max-wins (E02-4). Lease loss now stops the shard consumer (split-brain guard).

## NOT here
liveState (E02-4 — onBatch hook ready), rules/trips, metrics endpoint (E02-5).
