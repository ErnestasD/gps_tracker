# E02-5 Plan — Backpressure metrics + Grafana dashboard (M)

**Story:** IMPLEMENTATION_PLAN.md E02-5 · **Names frozen:** Appendix A · **Deps:** prom-client (ADR-017)

## Shape
- `apps/ingest/src/prom.ts` — /metrics on PROMETHEUS_PORT (9101): ingest_msgs_total,
  ingest_parse_fail_total, ingest_frame_violations_total, ingest_paused_sockets (+acked/
  rejected/sanity) reflected from IngestMetrics; ack_latency_ms histogram observed in
  session (t0 at frame arrival → after ACK write).
- `apps/worker/src/prom.ts` — stream_depth{shard} (XLEN on scrape), pipeline_lag_ms
  (now − max fixTime per batch; Grafana derives p95), pipeline_batch_rows histogram.
- `apps/api` — ws_clients gauge + /metrics route + minimal main.ts entrypoint (:3010, STUB_AUTH_TOKEN env until E03-1) so the scrape job is real.
- `infra/grafana/dashboards/ingest.json` — 8 panels covering every frozen metric;
  `infra/prometheus/prometheus.yml` — ingest/worker/api scrape jobs.

## AC status
- Frozen names served: exposition tests (ingest, worker) assert every name + values.
- "Flood past 50k → paused metric >0, zero loss, drains": the behaviour is proven in
  E01-5's backpressure e2e (pausedSockets gauge + drain-resume); the metric is now
  exported under the frozen name — the full 50k-scale run is the E07-3 load gate.
- Dashboard JSON committed; renders once local Prometheus scrapes the apps (staging
  wiring completes with E00-2).
