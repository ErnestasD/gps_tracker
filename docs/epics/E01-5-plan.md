# E01-5 Plan — Ingest TCP server (L)

**Story:** IMPLEMENTATION_PLAN.md E01-5 · **Implements:** §3.2 session flow, §6.1 top half, security posture
**Deps:** @orbetra/codec (framing/parse), ioredis + cbor-x (ADR-014) · **Status:** in progress

## Architecture (per spec — ZERO business logic, rule 3)
- `session.ts` — per-socket state machine `AWAIT_IMEI → STREAMING`:
  IMEI frame → registry lookup (Redis `registry:imei` hash) → `0x01`/`0x00`
  (+ quarantine ZADD, ≥3 rejects/hr per IMEI ⇒ close);
  AVL frame → parse → per-record sanity (ts window 2020-01-01..now+48h, coord range;
  rejects → `rejects` Redis stream for the worker) → pipelined `XADD raw:{imei%16}`
  (CBOR payload: deviceId, imei, serverTimeMs + parsed record + raw bytes for rec_hash)
  → **ACK = count actually persisted, ONLY after XADD returns** (rule 4 / I1) →
  cached shard-depth check (XLEN, 1 s refresh) → pause/resume socket (I4, default 50k);
  Codec 12/13/14 response frames → `RPUSH cmd:resp:{deviceId}` (E08-2 consumes);
  CRC/structure failure on a packet → ACK 0, session survives; framer violation
  (oversize/garbage) → count + destroy socket.
- `server.ts` — net server: total conn cap, per-IP cap (limits.ts), handshake timeout 10 s,
  read-idle timeout (default 40 min), SO_KEEPALIVE 60 s, duplicate-IMEI policy newest-wins.
- `limits.ts` — per-IP live connection counter (pure, unit-tested).
- `metrics.ts` — plain counters/gauges now (`msgs`, `parseFail`, `frameViolations`,
  `acked`, `rejectedImei`, `pausedSockets`); prom-client wiring arrives in E02-5.
- `registry.ts` — Redis lookups + quarantine bookkeeping.
- `main.ts` — env wiring per §6.7 (`INGEST_TCP_PORT=5027`, `INGEST_MAX_CONN`,
  `INGEST_MAX_CONN_PER_IP`, `REDIS_URL`).

## Tests (testcontainers redis:7-alpine; e2e drives the REAL simulator client)
happy liveDrive (ACKs == records, XLEN == records, CBOR payload decodes, shard = imei%16) ·
corrupt-CRC (ACK 0, session survives) · oversize (socket closed + violation counter) ·
unknown IMEI (0x00 + quarantine entry; 3rd reject/hr closes) · slow-loris (killed by
handshake timeout) · per-IP cap (N+1th refused) · backpressure (tiny threshold: pause
observed, resume after drain) · duplicate IMEI (old socket closed).
Chaos kill-9/XAUTOCLAIM assertions land in E02-3 per story.

## NOT here
DB inserts, normalize, rules, Codec 12 SENDING (E08-2), prom-client endpoint (E02-5).
