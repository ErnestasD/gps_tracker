# ADR-014: apps/ingest runtime dependencies — ioredis + cbor-x

**Date:** 2026-07-04 · **Status:** accepted · **Story:** E01-5 (CLAUDE.md rule 10 gate)

## Context
PROJECT_PLAN §6.1 mandates `XADD raw:{imei%16} * payload <cbor>` into Redis Streams.
Node has no built-in Redis client nor CBOR codec.

## Decision
- **ioredis** — Redis client for the ordered-pipeline side (streams XADD/XLEN). BullMQ
  (arriving with apps/worker) is built on ioredis, so this converges on one client
  library across the backend. Battle-tested pipelining/reconnect semantics.
- **cbor-x** — the spec names CBOR as the stream payload encoding (compact + binary-safe
  for raw record bytes, which JSON would base64-inflate by ~33%). cbor-x is the fastest
  maintained JS implementation, zero deps.

Both pinned with `^` in apps/ingest (worker will reuse the same choices in E02-3).

## Consequences
- Payload contract for `raw:{shard}` entries is CBOR-encoded (defined in packages/shared
  in E02-3 when the consumer lands; until then the shape is documented in ingest code).
- Redis client mocking is avoided in tests — testcontainers redis:7 keeps parity with prod.
