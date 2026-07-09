# E06-4 Plan — Webhook delivery (HMAC + retry + log)

> W6 S4. PROJECT_PLAN §6.5. Autonominė sesija. E06-4a delivery core (this); log-table+UI = E06-4b.

## Context

Webhook modelis + repo + CRUD JAU yra (packages/db/repos/webhooks.ts: url, secret, events[], enabled, nullableAccount, redact secret). DELIVERY nebuvo. §6.5: „webhook signature X-Signature: hmac-sha256(body, secret)"; retry BullMQ exp backoff max5. W6 exit: „webhook received & verified". Rule.channels webhook tipas buvo scope'intas IŠ E05-5 → čia.

## Sprendimai (E06-4a)

- **`apps/worker/src/webhook/sign.ts`** `signBody(body,secret)` → `sha256=<hmac-sha256 hex>` (node:crypto). PURE.
- **`apps/worker/src/jobs/webhookQueue.ts`** WEBHOOK_QUEUE + enqueueWebhook({deviceId,kind,at,payload}); jobId `wh:{dev}:{kind}:{atMs}` dedup; attempts:5 exp backoff.
- **`apps/worker/src/jobs/webhookWorker.ts`** runWebhook: resolve scope iš deviceId (device:tenant/device:account hget) — neregistruotas→drop; loadWebhooks raw SQL `WHERE tenantId=$1 AND (accountId=$2 OR accountId IS NULL) AND enabled AND (cardinality(events)=0 OR kind=ANY(events))`; body=JSON({kind,deviceId,at,payload}); POST kiekvienam su X-Signature; per-endpoint dedup Redis set `wh:sent:{jobId}` sismember→skip, sadd PO success; failų>0→throw→retry. onDelivered/onFailed metrics.
- **main.ts** webhookQueue+webhookWorker; `emitWebhook` helper (best-effort) enqueue'ina prie: rule persist site (šalia enqueueNotify), offline onEvents (flatMap notify+webhook), geofence transitions (kind='geofence', payload geofenceId/name/transition) — geofence NETURI ruleId/notify tako, tik webhook. SIGTERM close.
- **prom** webhook_delivered_total / webhook_failed_total.

## Failai

**Nauji:** apps/worker/src/webhook/sign.ts; apps/worker/src/jobs/{webhookQueue,webhookWorker}.ts; apps/worker/__tests__/webhook.spec.ts; docs/epics/E06-4-plan.md.
**Keičiami:** apps/worker/src/{main.ts, prom.ts}; README.

## Testai (7)

- signBody: verifiable HMAC; keičiasi su secret+body (integrity).
- runWebhook: POST signed body subscribed hook; empty events[]=ALL kinds; unregistered device→no-op; non-2xx→throw(retry)+onFailed; already-sent→skip (idempotent retry).

## Verifikacija (DoD)

Gates + 7 testų žali. §6.5 X-Signature hmac-sha256. §10 #7: scope resolve iš registry (ne guess), account+tenant-shared filtras. Retry idempotencija per sent-set (kaip notify). Secret niekada neloginamas (redact repo + tik signing).

## Rizikos

- **SSRF**: webhook.url yra tenant-admin sukonfigūruotas (POST validuoja URL schema E03-2 webhookCreateSchema z.string().url()); worker POST'ina į tą URL. Internal-network SSRF rizika — v1 priimtina (tenant-admin trusted), note follow-up (deny private IP ranges).
- **Retry storm**: attempts:5 exp backoff; per-endpoint dedup neblokuoja gerų.
- **Delivery-log persistence** = E06-4b (dabar metrics+logs observability). UI vėliau.
- **Geofence webhook**: enqueue iš transitions (turi deviceId+at). Rule/offline turi payload.
