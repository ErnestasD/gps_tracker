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

## What it measures

- ACK latency p99/p99.9 (exact, from raw samples; the histogram helper covers the
  scrape-from-`/metrics` path used on staging).
- throughput = acked records / wall-clock.
- zero loss = sent == acked, no under-acked packets, no failed sessions, and the ingest's
  own `ingest_msgs_total == ingest_acked_records_total`.
