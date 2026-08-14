# W7-S3 — load-test gate

The gate (§5): **1,500 msg/s for 10 min, p99 ACK < 250 ms, zero loss** (reconnect-storm).

## Run it

```sh
# defaults: 500 devices × 3 hz = 1500 msg/s target, 600 s (10 min)
pnpm --filter @orbetra/loadtest exec tsx src/main.ts
# or tune:
LOAD_DEVICES=550 LOAD_HZ=3 LOAD_DURATION_S=600 LOAD_RAMP_MS=8 \
  pnpm --filter @orbetra/loadtest exec tsx src/main.ts
```

The harness spins its OWN Redis (testcontainers) + an in-process ingest, so it never
touches the live staging box (orbetra.com is served from the same host). It seeds the whole
fleet into `registry:imei`, drives `runFleet(liveDrive, …)` with a fast ramp (reconnect
storm), captures ACK latency EXACTLY via the ingest's `observeAckLatencyMs` callback, and
prints a PASS/FAIL report. Exit code is non-zero on any gate miss.

## Why 550 × 3 hz

500 × 3 = 1500 is the exact target, but the wall-clock AVERAGE is dragged below 1500 by the
ramp-up + drain tails. Driving 550 (≈1650 steady-state) makes the average clear 1500 with
margin — a stronger result (the system holds p99 well under budget at >1500 msg/s).

## Where the number is valid

The committed report (`docs/audit/load-test-2026-07.md`) states the exact host. A dev
machine is not prod hardware — this proves the SOFTWARE meets the gate; the prod-hardware
gate (ADR-006 DB-placement decision) is re-run on the Hetzner AX42 before pilots, and the
report is updated with that number.

## The DECODE path is not in this gate — measured separately

This harness drives ingest: framing, CRC, ACK, XADD. The worker's decode path — resolving each
device's AVL dictionary and turning IO elements into `attrs` — is downstream of it and is not
exercised here, so per-model decoding was measured on its own after the dictionary work landed
(2026-08-14, same host):

```
normalize(), 20 IO elements per record, 200 000 iterations each
  fmb120 (640 elements)               7.1 µs/record   141 816 rec/s
  fmc650 (1197 elements — the worst)  7.3 µs/record   137 284 rec/s
  atc700 (40 elements)                7.7 µs/record   129 904 rec/s
```

Two things worth knowing from that. **Table size barely matters** — 8% across a 30× range of
element counts — because a dictionary is a `Map` and lookup is O(1); the earlier worry that a
1197-element table would cost more than a 40-element one is simply wrong. And one core clears the
1 500 msg/s gate by ~92×, so decoding is not near the budget.

The other cost the dictionary work added is one `HMGET device:config` per batch in `AvlTableCache`,
cached for 60 s. At the gate rate with `batchSize` 200 that is a few round trips per second across
all sixteen shards, and the cache absorbs almost all of them.

## What it measures

- ACK latency p99/p99.9 (exact, from raw samples; the histogram helper covers the
  scrape-from-`/metrics` path used on staging).
- throughput = acked records / wall-clock.
- zero loss = sent == acked, no under-acked packets, no failed sessions, and the ingest's
  own `ingest_msgs_total == ingest_acked_records_total`.
