# ADR-017: prom-client for metrics exposition (ingest, worker, api)

**Date:** 2026-07-04 · **Status:** accepted · **Story:** E02-5 (CLAUDE.md rule 10 gate)

PROJECT_PLAN §5 observability mandates Prometheus with custom metrics whose NAMES are
frozen in Appendix A / E02-5. prom-client is the official Prometheus JS client (zero deps).

v1 honesty notes (recorded, revisit in E07-1):
- Totals are exposed as monotonic gauges reflecting in-process counters (PromQL `rate()`
  handles them identically for our alert rules); histograms (`ack_latency_ms`,
  `pipeline_batch_rows`) are real prom-client Histograms observed at source.
- `pipeline_lag_ms` is the last batch's `now − max(fix_time)` gauge — the spec's "p95"
  materializes in Grafana via `quantile_over_time`, not in-process.
