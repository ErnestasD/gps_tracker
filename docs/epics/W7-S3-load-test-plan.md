# W7-S3 Plan — load-test gate

> PROJECT_PLAN §5 + §8 S3: „load-test gate: **1,500 msg/s for 10 min, p99 ACK < 250 ms, zero loss** (reconnect-storm model)". AC: **report committed**. Autonominė sesija.

## Kur leidžiam (svarbu)

orbetra.com + dash dabar GYVI ant to paties staging box (CPX31-class, 4 vCPU). 10-min 1500 msg/s hammer'is ant jo sutrikdytų gyvą demo IR neatspindėtų prod hardware (AX42). Todėl **izoliuotas** run'as: šviežias ingest+redis (Docker) lokaliai. Report'e aiškiai nurodomas hardware — prod-hardware gate (ADR-006 DB placement sprendimas) leidžiamas ant AX42 prieš pilotus (dokumentuota).

## Ką matuojam (ingest ACK kelias)

Gate = **ingest ACK** latency + zero loss. Ingest ACK'ina PO XADD į redis (rule 4 / I1) — tad ingest+redis pakanka ACK gate'ui; worker/pg drain = atskirai (soak W7-S6). Metrikos iš ingest `/metrics`:
- `ack_latency_ms` histogram → **p99** (iš bucket'ų, kaupiamų per run'ą; šviežias ingest = švarūs skaičiai).
- `ingest_msgs_total` / trukmė → **throughput** (taikinys ≥1500/s).
- **zero loss**: fleet `ackedRecords == sentPackets` (liveDrive = 1 record/pkt) IR `underAckedPackets == 0` IR ingest `ingest_acked_records_total == ingest_msgs_total`.

## Harness

- **tools/loadtest** (workspace tool): `src/histogram.ts` (PURE `p99FromBuckets(buckets)` — Prometheus histogram le→cumulative → linear-interp quantile; unit-testuota), `src/main.ts` (orchestratorius: seed'ina N imei į redis registry per simulator seed, `runFleet(liveDrive, {devices:N, hz:H, count:H*600})`, matuoja wall-clock, scrape'ina ingest /metrics, skaičiuoja p99/throughput/loss, rašo report'ą).
- **Reconnect-storm**: rampMs mažas (visi devices jungiasi per ~keliolika s), tada 10 min sustained.
- **Krūvis**: 500 devices @ 3 hz = 1500 msg/s (lengviau socket'ams nei 1500@1hz). count = 3*600 = 1800.
- **Loss guard**: bet koks under-ack ar msgs≠acked → gate FAIL, exit 1.

## Failai

**Nauji:** tools/loadtest/{package.json, tsconfig, vitest.config, src/histogram.ts, src/main.ts, __tests__/histogram.spec.ts}; docs/audit/load-test-2026-07.md (REPORT — AC); docs/runbooks/w7-load-test.md; docs/epics/W7-S3-load-test-plan.md; ADR-006 update (DB placement — same-host container tinka iki X msg/s pagal šį run'ą).
**Keičiami:** README (load-test pastaba); pnpm-workspace (tools/* dengia).

## Verifikacija (DoD — AC = report committed)

- Report'as `docs/audit/load-test-2026-07.md`: hardware, konfigas (devices/hz/duration), rezultatai (throughput, p99 ACK, loss), PASS/FAIL prieš gate, pastabos, ADR-006 išvada.
- p99FromBuckets unit-testuota (žinomi bucket'ai → žinomas p99).
- Harness reproduktyvus (`pnpm loadtest`), dokumentuotas runbook'e.
- Jei p99 > 250ms ar loss > 0 ant izoliuoto stack'o — report'as tai SĄŽININGAI fiksuoja + tuning follow-up (ne slepiam).

## Rizikos

- **Lokalus hardware ≠ prod**: Mac/dev mašina galingesnė nei CPX31, silpnesnė nei AX42 I/O. Report'as nurodo tikslų hostą; skaičius = software-pajėgumo įrodymas, ne prod-sizing (tas = AX42).
- **Node single-process 1500 sockets**: 500@3hz lengviau; jei socket-bound, report'as pažymi ir siūlo multi-process replay (tools/replay 100× — §7 harness).
- **Histogram bucket'ai**: ack_latency_ms bucket'ai [1,5,10,25,50,100,250,500,1000] — jei p99 patenka >1000 (+Inf), interp grąžina bucket ribą + pastabą (ne melagingą tikslų skaičių).
