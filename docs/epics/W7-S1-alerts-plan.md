# W7-S1 Plan — Grafana/Prometheus alert rules → founders' Telegram

> PROJECT_PLAN §8 W7 S1: „Grafana alert rules → founders' Telegram (stream depth, pipeline lag, parse-fail spike, disk, cert expiry)". Autonominė sesija.

## Sprendimas: Prometheus alert rules + Alertmanager → Telegram (ne Grafana-managed alerts)

Grafana jau prijungta prie Prometheus (dashboards yra), bet alertavimui švariau ir versijuojama laikyti taisykles Prometheus'e + maršrutizuoti per **Alertmanager** → Telegram. Tai atitinka §5 stack'ą ir yra promtool-testuojama (skirtingai nei Grafana-UI alertai).

## Metrikų tiesa (iš kodo, ne iš spėjimo)

- ingest (`apps/ingest/src/prom.ts`): `ingest_msgs_total`, `ingest_parse_fail_total`, `ingest_frame_violations_total`, `ingest_acked_records_total`, `ingest_rejected_imei_total`, `ack_latency_ms` (histogram), `ingest_paused_sockets`.
- worker (`apps/worker/src/prom.ts`): `stream_depth` (gauge), `pipeline_lag_ms` (gauge), `pipeline_batch_rows`, `*_total` counteriai.
- Nauji exporter'iai: `node_exporter` (disk/RAM), `blackbox_exporter` (TLS cert expiry probing https).

## Alertai (§8 S1 sąrašas)

1. **StreamDepthHigh** — `stream_depth > 50000` 5 min (MAXLEN ~100k per shard; 50% = consumeriai atsilieka). warning; `> 90000` 2min → critical.
2. **PipelineLagHigh** — `pipeline_lag_ms > 30000` 5 min (lag > 30 s = trip/GDPR guard'ai rizikuoja). warning; `> 120000` → critical.
3. **ParseFailSpike** — `rate(ingest_parse_fail_total[5m]) > 5` 10 min (staigus CRC/struktūros fail'ų šuolis = protokolo/hardware problema).
4. **DiskFillingUp** — `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.15` 10 min (positions hypertable auga; <15% = veiksmo laikas). `< 0.05` → critical.
5. **CertExpiringSoon** — `probe_ssl_earliest_cert_expiry - time() < 14*24*3600` (blackbox probe orbetra.com/dash — Caddy auto-renew, bet alert jei nepavyko).
6. **Papildomai (nemokamai iš turimų metrikų):** `AckLatencyHigh` (histogram p99 > 250ms 5min — §5 SLA), `TargetDown` (up==0 2min — bet kuris app kritęs), `BackpressureSustained` (`ingest_paused_sockets > 0` 10min).

## Alertmanager → Telegram

Alertmanager 0.26+ `telegram_configs` su `bot_token` + `chat_id`. **BLOCKED-INFO** (kaip SES/E05-5): TELEGRAM_BOT_TOKEN + founder chat_id — founder turi pateikti. Konfigas rašomas su env-substitucija (`amtool`/entrypoint envsubst), skip/no-op kol token'o nėra; dokumentuota runbook'e. Iki tol alertai matomi Alertmanager UI (per SSH tunelį) + Prometheus /alerts.

## Failai

**Nauji:** infra/prometheus/alerts.yml (rules); infra/prometheus/alerts.test.yml (promtool unit testai — kiekvienas alertas fire'ina/tyli teisingai); infra/alertmanager/{alertmanager.yml.tmpl, README}; infra/blackbox/blackbox.yml; docs/runbooks/w7-alerting.md; docs/epics/W7-S1-alerts-plan.md.
**Keičiami:** infra/prometheus/{prometheus.yml, prometheus.staging.yml} (rule_files + alerting + node/blackbox scrape jobs); infra/compose/docker-compose.yml (alertmanager, node-exporter, blackbox-exporter — loopback-bind kaip visi vidiniai, PR #11); README (env TELEGRAM_ALERT_CHAT_ID pastaba).

## Testai / verifikacija

- **promtool test rules** infra/prometheus/alerts.test.yml — CI-tinkamas (docker prom/prometheus promtool). Padengia: stream depth warn+crit ribos, lag, parse-fail rate, disk %, cert expiry, target down.
- Staging: `promtool check rules` + Prometheus /alerts rodo taisykles LOADED; blackbox probe orbetra.com → probe_success=1.
- Alertmanager UI per SSH tunelį; test alert per `amtool alert add` kai token'as bus.

## Rizikos

- **Telegram BLOCKED**: routing paruoštas, token founder-gated (dokumentuota). Iki tol — Prometheus/Alertmanager UI.
- **node_filesystem mountpoint**: alertas filtruoja `mountpoint="/"` (host root) — kad ne per-container FS.
- **cert expiry**: Caddy pats atnaujina; alertas = safety net jei renew nepavyko (14 d langas).
