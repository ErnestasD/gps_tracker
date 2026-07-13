# W7-S1 — Alerting (Prometheus rules → Alertmanager → Telegram)

Alert rules live in `infra/prometheus/alerts.yml` (unit-tested: `infra/prometheus/alerts.test.yml`).
Alertmanager routes them to the founders' Telegram.

## Alerts (PROJECT_PLAN §8 S1)

| Alert | Fires when | Severity |
|---|---|---|
| StreamDepthHigh / Critical | `stream_depth` > 50k /90k | warn / crit |
| PipelineLagHigh / Critical | `pipeline_lag_ms` > 30s / 120s | warn / crit |
| ParseFailSpike | `rate(ingest_parse_fail_total[5m])` > 5/s for 10m | warn |
| AckLatencyHigh | ACK p99 > 250ms (§5 SLA) | warn |
| BackpressureSustained | `ingest_paused_sockets` > 0 for 10m | warn |
| DiskFillingUp / Critical | root FS < 15% / 5% free | warn / crit |
| TargetDown | any of ingest/worker/api unscrapeable 2m | crit |
| CertExpiringSoon | TLS cert < 14d to expiry (Caddy renew safety net) | warn |

## Telegram (BLOCKED-INFO — founder must provision, like SES)

Alertmanager needs two values in the server `/opt/orbetra/.env`:
- `TELEGRAM_BOT_TOKEN` — from @BotFather (`/newbot`).
- `TELEGRAM_ALERT_CHAT_ID` — the founders' group/chat id (add the bot, then
  `curl https://api.telegram.org/bot<token>/getUpdates` and read `chat.id`).

`infra/alertmanager/entrypoint.sh` renders `alertmanager.yml.tmpl` with `envsubst` at
container start. **Until both are set**, Alertmanager runs with a placeholder receiver —
alerts are still visible in the Alertmanager UI and Prometheus `/alerts` (no Telegram push).

Same `TELEGRAM_BOT_TOKEN` also unblocks E05-5 notification delivery — set it once.

## Verify

```sh
# rules valid + unit tests pass (pin the image so humanize() output is stable)
docker run --rm --entrypoint promtool -v "$PWD/infra/prometheus":/w \
  prom/prometheus:latest test rules /w/alerts.test.yml

# on the server (SSH tunnel): Prometheus rules loaded, blackbox probing our hosts
ssh -L 9090:127.0.0.1:9090 -L 9093:127.0.0.1:9093 -i ~/.ssh/orbetra_staging root@185.80.129.33
#   http://localhost:9090/alerts   → all rules "inactive" (green) until a threshold trips
#   http://localhost:9090/targets  → node, blackbox-tls, ingest/worker/api all UP
#   http://localhost:9093          → Alertmanager UI
```

## Fire a test alert (once Telegram is set)

```sh
docker exec orbetra-alertmanager-1 amtool alert add \
  alertname=TestPage severity=critical --alertmanager.url=http://localhost:9093
```
Should arrive in the Telegram chat within `group_wait` (0s for critical).
