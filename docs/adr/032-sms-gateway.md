# ADR-032: Provider-abstract SMS gateway (Teltonika config SMS)

Status: accepted (founder decision, 2026-07-21)

## Context

To point a Teltonika device at our server WITHOUT any Teltonika software, an operator today copies the
config SMS that `buildOnboarding()` generates (`packages/shared/src/onboarding.ts`) and sends it by hand
from a phone holding the device's SIM number. The founder wants the platform to send that SMS itself (and
later arbitrary SMS commands) directly to a device's SIM.

The multi-client reality is that different tenants use different SIMs from different carriers, and some run
their own SMS provider accounts. A hardcoded single-provider integration would not survive that. The design
is therefore provider-abstract from day one, even though V1 ships a single platform-default provider.

SMS is also a *billable* channel: every send is a real charge on our provider account. That colours several
choices below (entitlement gating, retry budget, redelivery guard) that the free channels (email/telegram/
webpush) do not need.

## Decision

1. **Provider-abstract `SmsDriver`.** A driver SENDS one message and returns a provider message id, or
   THROWS on a transient failure (the BullMQ sms worker retries) — the exact contract the notify drivers use
   (`apps/worker/src/notify/drivers.ts`). The interface is `send(to, body): Promise<{ providerMessageId }>`.
   A driver that is not configured (no credentials) is simply absent — the send route then 503s and the UI
   hides the button, rather than failing a job. Adding a second provider later is a new driver + a selector,
   with no change to the queue, worker, API, or web contract.

2. **Twilio is the first and default driver.** The Twilio driver is an HTTPS `POST` to
   `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json` with HTTP Basic auth (`SID:token`,
   base64 via `Buffer`) and a form body (`To`/`From`/`Body`) built with `URLSearchParams` — over **native
   `fetch`, with NO `twilio` npm SDK**. This mirrors the telegram driver (plain fetch, no dependency) and
   honours rule 10 (no new runtime dependency without an ADR — this ADR deliberately declines to add one).
   The Twilio SDK would pull a large transitive tree for one HTTP call we can make ourselves.

3. **Env-gated exactly like email.** The channel reads `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and
   `TWILIO_FROM` from the server `.env` (rule 12 — never in code or fixtures). Any one absent ⇒ the channel
   is disabled: `smsDriverFromEnv` returns undefined (like `buildEmailTransport`), the send route answers
   503, and the web "Send config SMS" button is hidden. No secrets ever reach a log line.

4. **Per-tenant creds DEFERRED (V1 = platform-default only).** V1 sends every tenant's SMS through the one
   platform Twilio account. A `tenant_sms_config` table (a white-label tenant using its OWN Twilio SID/token)
   is *designed* but deliberately not shipped: storing a tenant's provider token requires at-rest encryption
   we do not have yet, and shipping plaintext tenant secrets would violate rule 12. Per-tenant creds are a
   follow-up gated on that encryption work. The provider-abstract driver seam means adding them later does
   not disturb the send path.

5. **New `smsGateway` entitlement (tsp-only).** Because each send is a billable Twilio charge, the send/list
   routes carry a plan `entitlement: 'smsGateway'` on their `RouteDef` — true for `tsp_*` plans only, false
   for `direct_*`. Direct plans keep the free copy-paste onboarding SMS fallback; only reseller (TSP) plans,
   who are already metered, get platform-sent SMS. A viewer role is additionally blocked — the routes are
   `ACCOUNT_WRITERS`-gated.

6. **`sms_deliveries` table now.** Each send creates a row (`deviceId`, `accountId`, `to`, `body`,
   `provider`, `providerMessageId`, `status`, `error`, timestamps). It is the pollable status the web UI
   watches (queued → sent/failed), the audit trail of what config SMS went to which SIM, and the record that
   ties a send to its billable charge. Returning the send result synchronously would lose all three, so the
   table ships in V1 rather than being a follow-up.

7. **At-most-once-ish redelivery guard (no double-charge).** Before calling Twilio, the sms worker does a
   Redis `SETNX sms:sent:{smsDeliveryId}` (24 h TTL). If the key already exists, a previous attempt already
   charged us and the job merely requeued (ack loss) — the worker skips the resend and reconciles status.
   The guard is released only when the send provably did NOT happen (a permanent 4xx, or a transient throw
   before the charge). A successful send leaves the guard set, so a duplicate job short-circuits. This
   accepts the rare window where Twilio charged but our status UPDATE crashed — the guard still prevents the
   resend on requeue. Sending the same config SMS twice is mostly harmless to the device, but it is a
   duplicate charge, so at-most-once-ish is the right posture for a paid channel.

8. **`attempts: 3` (fewer than notify's 5).** The retry budget is deliberately smaller than the free notify
   channels: every retry is a potential charge, so exposure is bounded at three exponential-backoff attempts
   rather than five.

9. **Locked-SIM manual fallback stays.** Many field SIMs are data-only or carrier-locked against inbound SMS;
   for those the platform-sent path cannot work at all. The existing copy-paste onboarding SMS (operator
   sends from a phone) remains visible as the always-available fallback, independent of whether the SMS
   channel is configured.

## Consequences

- New table `sms_deliveries` (append-only migration) + a scoped `smsDeliveries` repo (WP-A).
- New worker driver (`apps/worker/src/sms`) + a `sms` BullMQ queue and worker with the SETNX guard, plus
  `sms_sent_total` / `sms_failed_total` metrics (WP-B).
- New routes `POST /v1/devices/:id/sms` (enqueue) and `GET /v1/devices/:id/sms` (poll status), both
  `ACCOUNT_WRITERS` + `entitlement: 'smsGateway'`; the API enqueues but never sends (WP-C).
- New `smsGateway` entitlement in the plan matrix (`packages/shared/src/plans.ts`), true for `tsp_*` only.
- Device gains a `simMsisdn` (+ `simIccid`) field; the send route 400s when it is unset (WP-A/WP-C/WP-D).
- Requires `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` in the server `.env` for the channel to
  be live; all three absent ⇒ send route 503s and the web button is hidden (documented in the README env
  table and wired into `docker-compose.apps.yml`).
