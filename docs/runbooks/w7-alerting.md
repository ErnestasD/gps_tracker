# W7-S1 — Alerting (Prometheus rules → Alertmanager → Telegram)

Alert rules live in `infra/prometheus/alerts.yml` (unit-tested: `infra/prometheus/alerts.test.yml`).
Alertmanager routes them to the founders' Telegram.

## Alerts (PROJECT_PLAN §8 S1)

| Alert | Fires when | Severity |
|---|---|---|
| StreamDepthHigh / Critical | `stream_depth` (consumer-group lag + pending, **not** XLEN) > 50k / 90k | warn / crit |
| PipelineLagHigh / Critical | `pipeline_lag_ms` > 30s / 120s | warn / crit |
| ParseFailSpike | `rate(ingest_parse_fail_total[5m])` > 5/s for 10m | warn |
| AckLatencyHigh | ACK p99 > 250ms (§5 SLA) | warn |
| BackpressureSustained | `ingest_paused_sockets` > 0 for 10m | warn |
| UnsupportedCodecSeen | `rate(ingest_unsupported_codec_total[15m])` > 0 for 15m | warn |
| DeadLetteredRows | `rate(pipeline_dead_lettered_total[15m])` > 0 for 15m | warn |
| BillingWebhookUnmatched | `increase(billing_webhook_unmatched_total{reason="no_tenant"}[1h])` > 0 for 5m | crit |
| SmsQuotaTripped | `increase(sms_quota_rejected_total{scope="global"}[1h])` > 0 for 5m | crit |
| DiskFillingUp / Critical | root FS < 15% / 5% free | warn / crit |
| TargetDown | any of ingest/worker/api unscrapeable 2m | crit |
| CertExpiringSoon | TLS cert < 14d to expiry (Caddy renew safety net) | warn |

### UnsupportedCodecSeen

Real hardware is sending a codec we verify but cannot decode (codec 16 today). The frame is parked
in the `raw:unsupported` stream and the device is ACKed its declared record count, so it advances its
buffer instead of resending forever — but **those positions are not in the pipeline**. This is a
product gap, not an incident: identify the model/firmware from the parked frames
(`XRANGE raw:unsupported - + COUNT 5`, the payload carries `imei` + the raw bytes) and open a codec
story. `raw:unsupported` is a bounded 10k sample, not an archive — nothing replays it today.

### DeadLetteredRows

A record was dropped from the pipeline and quarantined in `raw:dead`. Check `reason`:
- `malformed` — the stream payload did not decode/validate (CBOR or schema). Suspect a producer bug.
- `rejected_by_db` — Postgres refused the row on its own merits (SQLSTATE class 22/23, e.g. a value
  no column accepts). The batch's other records were still written and ACKed; only this row is lost.
  Inspect the payload and add a bound in `normalize.ts` so the next one is nulled rather than dropped.

Both are *customer-visible data loss for that record*, so any sustained rate deserves a fix, not a mute.

### BillingWebhookUnmatched

A Stripe subscription webhook passed signature verification and then provisioned nothing because
**no tenant row carries that `stripeCustomerId`**. Someone is paying and has no plan.

Only `reason="no_tenant"` pages. A `stale` outcome is normal — the monotonic and per-subscription
guards drop replayed, out-of-order and same-second deliveries by design, and reporting those as
failures made this alert fire on routine traffic in an earlier iteration.

Stripe is acked 200 deliberately: a retry cannot conjure a missing customer mapping, and a 500 would
make Stripe hammer the endpoint for days. So this alert is the only signal.

1. Find the customer id in the api log line (`stripe webhook: no tenant for customer`).
2. Look it up in Stripe → the customer's email → the tenant.
3. `UPDATE tenants SET "stripeCustomerId" = '<cus_…>' WHERE id = '<tenant>'`, then resend the event
   from the Stripe dashboard (Developers → Events → Resend) so the plan/status apply.

The known way to get here: two concurrent checkouts during a Redis outage. The per-tenant lock falls
through on a blip and `ensureCustomer` is not idempotency-keyed, so Stripe can end up holding a
customer we never stored.

### SmsQuotaTripped

The platform-wide SMS breaker (`SMS_QUOTA_GLOBAL_PER_DAY`, default 1000/day) has refused a send.
Every config SMS is a real billable message from **our** Twilio sender, so this ceiling is the last
thing between a runaway loop and an unbounded bill — but while it is tripped, config-SMS onboarding
returns 503 for **every** tenant.

1. Find the source: `sms_quota_rejected_total{scope="device"|"tenant"}` and the `sms_deliveries`
   table (`SELECT "tenantId", count(*) FROM sms_deliveries WHERE "createdAt" > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC`).
2. If it is legitimate growth, raise `SMS_QUOTA_GLOBAL_PER_DAY` in `/opt/orbetra/.env` and restart the api.
3. Reset the window manually with `DEL sms:q:global` (the key is a fixed 24 h window anchored at the
   first send, so it does not roll early on its own).

Per-device (5/day) and per-tenant (100/day) rejections are informational — they mean a caller is
retrying, not that the platform is at risk.

## Telegram (BLOCKED-INFO — founder must provision, like SES)

Alertmanager needs two values in the server `/opt/orbetra/.env`:
- `TELEGRAM_BOT_TOKEN` — from @BotFather (`/newbot`).
- `TELEGRAM_ALERT_CHAT_ID` — the founders' group/chat id (add the bot, then
  `curl https://api.telegram.org/bot<token>/getUpdates` and read `chat.id`).

`infra/alertmanager/entrypoint.sh` renders `alertmanager.yml.tmpl` with `sed` at container
start (the alertmanager image has no `envsubst`); a Telegram token/chat-id contains no sed
metacharacters, so substitution is safe. **Until both are set**, Alertmanager runs with a placeholder receiver —
alerts are still visible in the Alertmanager UI and Prometheus `/alerts` (no Telegram push).

Same `TELEGRAM_BOT_TOKEN` also unblocks E05-5 notification delivery — set it once.

## Verify

```sh
# rules valid + unit tests pass (pin the image so humanize() output is stable)
docker run --rm --entrypoint promtool -v "$PWD/infra/prometheus":/w \
  prom/prometheus:v3.1.0 test rules /w/alerts.test.yml

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
