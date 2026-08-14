# W7-S1 — Alerting (Prometheus rules → Alertmanager → Telegram)

Alert rules live in `infra/prometheus/alerts.yml` (unit-tested: `infra/prometheus/alerts.test.yml`).
Alertmanager routes them to the founders' Telegram.

## Alerts (PROJECT_PLAN §8 S1)

| Alert | Fires when | Severity |
|---|---|---|
| StreamDepthHigh / Critical | `stream_depth` (consumer-group lag + pending, **not** XLEN) > 50k / 90k | warn / crit |
| PipelineLagHigh / Critical | `pipeline_lag_ms` > 30s / 120s | warn / crit |
| ParseFailSpike | `rate(ingest_parse_fail_total[5m])` > 5/s for 10m | warn |
| IngestSheddingDatagrams | `rate(ingest_udp_inflight_drops_total[5m])` > 0 for 5m | crit |
| PipelinePendingEvicted | `increase(pipeline_pending_evicted_total[1h])` > 0 for 1m | crit |
| AckLatencyHigh | ACK p99 > 250ms (§5 SLA) | warn |
| BackpressureSustained | `ingest_paused_sockets` > 0 for 10m | warn |
| UnsupportedCodecSeen | `rate(ingest_unsupported_codec_total[15m])` > 0 for 15m | warn |
| DeadLetteredRows | `rate(pipeline_dead_lettered_total[15m])` > 0 for 15m | warn |
| AvlTableUnresolved | `rate(pipeline_avl_table_unresolved_total{reason!="no_config"}[15m])` > 0 for 15m | warn |
| BillingWebhookUnmatched | `increase(billing_webhook_unmatched_total{reason="no_tenant"}[1h])` > 0 for 5m | crit |
| WorkerJobFailing | `increase(worker_job_failed_total[1h])` > 0 for 10m | crit |
| UsageSweepFailing | `increase(usage_sweep_failed_total[1h])` > 0 for 10m | crit |
| EnginePersistErrors / TripPersistErrors | non-zero over 15m/1h | warn |
| NotificationsFailing / WebhooksFailing | `rate(...)` > 0.1/s for 15m | warn |
| GdprJobFailing | `increase(gdpr_failed_total[1h])` > 0 for 10m | crit |
| ExporterDown | `up{job=~"node\|postgres\|blackbox-tls\|prometheus"}` == 0 for 5m | crit |
| EndpointDown | `probe_success` == 0 for 3m | crit |
| ApiErrorRate | 5xx share > 5% for 5m | crit |
| ApiLatencyHigh | p95 > 2s on a route for 10m | warn |
| SmsQuotaTripped | `increase(sms_quota_rejected_total{scope="global"}[1h])` > 0 for 5m | crit |
| DeviceCreateThrottled | `increase(device_create_throttled_total[1h])` > 0 | warn |
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

### AvlTableUnresolved

Devices are being decoded with the **fallback** AVL dictionary (`fmb120`) instead of the one their
device profile names. Nothing looks broken: positions arrive, the map moves, trips close. What is
wrong is every IO attribute's NAME and SIGN — id 141 is "Battery Temperature" (Signed) on an FMx6xx
and "Driver 1 Cumulative Break Time" (Unsigned) on the fallback, so a −0.1 °C reading is stored as
65535. It is written to `positions.attrs` and **nothing recomputes it**, so the rows produced during
the incident stay wrong after it is fixed. Check `reason`:

- `redis_error` — the worker cannot read `device:config`. An incident, not a data problem: fix Redis
  and the next batch self-corrects. Only devices with no cached table at all are counted here, and
  they are the only ones affected — a device whose cache entry merely expired keeps its own table
  and decodes correctly throughout the outage. This reason is not cached (so the next batch retries
  immediately), so it repeats per batch while the outage lasts; read its rate as "an outage is
  happening", not as a device count.
- `unknown_table` — a device profile names a dictionary this build does not ship. The profile row is
  wrong (or the deploy is older than the profile seed). Find it with
  `SELECT key, "avlTable" FROM device_profiles WHERE "avlTable" NOT IN (…shipped tables…)`.
- `malformed` / `no_field` — something wrote `device:config` without going through
  `deviceConfigValue`. Find the writer; that helper exists precisely so the six of them cannot drift.
- `no_config` — **excluded from the alert.** Expected briefly after a Redis flush until the API's
  boot rehydrate republishes the fleet. If it persists, the rehydrate is not running.

The counter counts RESOLUTIONS, not records, and resolutions are cached for ~60 s — so a device
stuck on the fallback at 60 records/min contributes about 1, not 60. Read it as "how many devices",
not "how many positions".

### WorkerJobFailing / UsageSweepFailing

The worker's failure counters existed for months with comments saying "non-zero rate ⇒ alert" and
**not one alert rule referenced them** — a job throwing on every run looked exactly like a quiet
system. These are the rules that were missing.

`stripe_usage` and `usage_sweep` are the sharp ones: `usage_daily` is the only source for overage
billing and the reporter submits `now − 24h` with **no backfill**, so every failed run is revenue
lost permanently. Treat them as an incident, not a warning.

`retention` failing means positions and webhook deliveries are growing past the policy we publish —
a compliance problem, not just a disk one.

### ExporterDown

`node_exporter` and `postgres_exporter` feed the disk-full and WAL-archive rules. A Prometheus rule
whose series **disappears** simply stops evaluating — it does not fire. So an exporter crash-loop
did not merely lose its own metrics, it silently disarmed every safety net built on them. This rule
watches the watchers.

### ApiErrorRate / ApiLatencyHigh

The API used to export exactly one metric (`ws_clients`), so `up == 1` held for a process answering
every single request with a 500 — the only rule covering it was `up == 0`, which catches a dead port
and nothing else. It now exports default process metrics plus request counters and latency by route
template (never raw path — that would grow a series per device id).

p95 above 2 s on a route is usually pg pool saturation (max 10, no acquire timeout) or an unbounded
report query.

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

## DeviceCreateThrottled

`device_create_throttled_total{why="limit"}` — a tenant hit the per-tenant device-creation ceiling
(`DEVICE_CREATE_MAX_PER_WINDOW`, default 10 000/hour). Only successful creations are *billed*, so
this is usually not a bad CSV or a retry storm — but reservations are taken before the work, and a
1000-row import reserves 1000, so enough concurrent imports can trip the ceiling having created
nothing. Step 1 tells the two apart.

1. Which tenant: `SELECT "tenantId", count(*) FROM devices WHERE "createdAt" > now() - interval '1 hour' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`.
   **If this finds nothing**, the ceiling was tripped by concurrent in-flight reservations rather
   than by creations — benign, self-clearing, no action.
2. If it is a genuine onboarding, clear that one tenant with `DEL devcreate:rl:<tenantId>` — it takes
   effect immediately and leaves everyone else's budget alone. Raise
   `DEVICE_CREATE_MAX_PER_WINDOW` in `/opt/orbetra/.env` and restart the api only if it recurs.
3. If it is not, look at whether those devices ever reported: a fleet of rows that never connect is
   what an IMEI squat looks like (`SELECT count(*) FROM devices d WHERE d."tenantId" = $1 AND NOT
   EXISTS (SELECT 1 FROM positions p WHERE p.device_id = d.id)`). The remedy for a squatted IMEI is
   a platform quarantine claim, which releases a retired holder in another tenant — see
   `docs/audit/tenant-isolation-2026-08-11.md`. **Precondition:** the claim only overrides a retired
   holder while the IMEI is in quarantine (`ZSCORE quarantine:imei <imei>`). If the victim's tracker
   is powered off, or its entry was pushed out by the 10 000-entry rank trim, the claim answers 409
   like any other conflict — have them power the tracker on so ingest re-adds it, then claim.

`why="degraded"` is the opposite problem: Redis could not be consulted and the create was let
through. The ceiling is fail-open on purpose, but a sustained degraded rate means the guard is
absent, not that it is quiet.

`why="refund_failed"` is the third case and needs the opposite reflex to `degraded`: a reservation
could not be handed back, so a tenant is carrying a phantom charge — up to a whole 1000-row import —
for the rest of the window, and may hit `limit` having created far fewer devices than the ceiling.
Clear it with `DEL devcreate:rl:<tenantId>`.

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

### Email is the fallback, and it is why the null receiver is no longer acceptable

**What the null receiver cost (2026-08-13):** `WalArchiveFailing` — critical — fired
continuously for eight days while `pg_wal` grew to 11 GB, about twelve days short of the
disk filling and PostgreSQL refusing writes. The rule was right, the alert was right, and
nobody was told, because "visible in the UI" means visible to whoever opens the UI. A
working alarm with no live recipient is worse than no alarm: it reads as coverage.

So the entrypoint now picks the first receiver it can actually deliver with:

| Order | Receiver | Needs |
|---|---|---|
| 1 | Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID` (founder-provisioned) |
| 2 | **Email** | `ALERT_EMAIL_TO` + the SES SMTP vars the platform ALREADY mails with |
| 3 | null | neither — UI only, and now a state to fix rather than accept |

Email needs **no new credential**. The SMTP password is written to a file and referenced as
`smtp_auth_password_file` rather than substituted into the config: an SES secret is base64
and may contain `/` or `+`, and `&` is a back-reference in a `sed` replacement.

Which tier rendered is stated at container start:

```sh
docker logs orbetra-alertmanager-1 | grep "alertmanager: routing"
```

Prove the whole path end to end — this sends a real message:

```sh
docker exec orbetra-alertmanager-1 wget -qO- \
  --post-data='[{"labels":{"alertname":"PipelineTest","severity":"critical","component":"selftest"},
  "annotations":{"summary":"test","description":"test"}}]' \
  --header='Content-Type: application/json' http://127.0.0.1:9093/api/v2/alerts
# then: non-zero sends, zero failures
docker exec orbetra-alertmanager-1 wget -qO- http://127.0.0.1:9093/metrics \
  | grep -E 'alertmanager_notifications_(total|failed_total)\{integration="email"'
```

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

## PipelinePendingEvicted

Records that were ACKed to their devices — so the devices deleted their own copies — were trimmed
out of the stream by `MAXLEN` before a consumer claimed them. **They are gone.** Nothing re-derives
them, and the reported number is a LOWER BOUND: the autoclaim `COUNT` caps the deleted-id list per
call, so a shard that trimmed past a large pending list reports it 200 at a time.

**Do not start at `stream_depth`.** It is lag + pending, while the trim is on total XLEN, so a batch
stuck pending while the loop reads and ACKs newer ones can be destroyed with depth in the low
hundreds and `StreamDepthCritical` never close. That is exactly why this counter exists.

Start at what stopped the consumer for the labelled shard: a worker restart loop, a poison batch
throwing inside `process()`, a DB outage, or shard-lease churn. `pipeline_dead_lettered_total` and
the worker logs for that shard are the next stop.

## IngestSheddingDatagrams

The UDP in-flight handler cap is being hit, which happens when Redis is slow or unreachable. Devices
re-send, so nothing is lost — but ingest is refusing traffic and no other signal shows it:
`up{job="ingest"}` stays 1 because `/metrics` never touches Redis, and
`ingest_udp_backpressure_drops_total` is gated behind a shard-depth READ (itself a Redis call), so
it stays flat during exactly this stall. Check Redis latency and `stream_depth` first.
