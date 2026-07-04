# ADR-015: apps/worker + packages/shared runtime dependencies

**Date:** 2026-07-04 · **Status:** accepted · **Story:** E02-3 (CLAUDE.md rule 10 gate)

## Decisions
- **apps/worker: ioredis + cbor-x** — same choices and rationale as ingest (ADR-014);
  the worker consumes the CBOR stream entries ingest produces.
- **apps/worker: xxhash-wasm** — §6.1 I3 mandates `rec_hash = xxhash64(raw record bytes)`
  reinterpreted as SIGNED bigint. xxhash-wasm is dependency-free WASM (no native build
  step in CI), deterministic across platforms. Signed reinterpretation via
  `BigInt.asIntN(64, h)` — the §6.3/R10 two's-complement trap is covered by a dedicated
  test with a hash > 2^63−1.
- **packages/shared: zod** — named in PROJECT_PLAN §5 as the single source of types
  ("packages/shared zod schemas"); recording here for the rule-10 paper trail.

## Consequences
- The `raw:{shard}` payload contract now lives in `packages/shared/src/records.ts`
  (zod-validated on consume; malformed entries → `raw:dead` stream, never crash the shard).
