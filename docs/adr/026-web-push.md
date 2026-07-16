# ADR-026: Web push notifications (VAPID / web-push)

**Status:** Accepted · **Date:** 2026-07-16 · **Deciders:** founder (approved), autonomous session

## Context

The notification pipeline (E05-5) delivers rule events to **email** (SES) and **telegram** channels.
A **browser push** channel lets an operator get alerts on their desktop/phone without email/telegram —
the app is already a PWA with a service worker. Push needs the standard Web Push protocol (RFC 8291)
with VAPID (RFC 8292) application-server keys.

## Decision

**Add a `webpush` notification channel** using the standard Web Push protocol via the `web-push` npm
library (apps/worker — new runtime dep, this ADR satisfies hard-rule 10). A single VAPID keypair
identifies our application server:
- **VAPID public key** — served to the client (safe to expose) so the browser can subscribe.
- **VAPID private key** — server `.env` only (`VAPID_PRIVATE_KEY`), never git (rule 12).

Flow:
1. The browser (PWA service worker) requests Notification permission + `PushManager.subscribe(vapidPublicKey)`
   → a `PushSubscription` (endpoint + p256dh + auth keys).
2. The client POSTs the subscription to `POST /v1/push/subscribe`; it's stored scoped to the user's
   tenant/account (`push_subscriptions`).
3. A rule with a `{type:'webpush'}` channel: the worker looks up the account's subscriptions and sends
   a push to each via `web-push`. A `410 Gone`/`404` from the push service prunes a dead subscription.
4. The service worker's `push` event shows a notification.

Unlike email/telegram (target lives in the channel: `to`/`chatId`), the `webpush` channel has **no
target** — it fans out to the account's stored browser subscriptions. Env-gated like the others: no
VAPID keys ⇒ the webpush channel is skipped (metric), never failed.

## Alternatives considered

- **FCM / APNs directly** — vendor-specific, needs native apps; Web Push is the open standard and works
  in every modern browser (incl. iOS 16.4+ PWAs).
- **Polling / SSE in-app toasts** — only works while the tab is open; push works when the app is closed.

## Consequences

New `apps/worker` dep `web-push`. A `push_subscriptions` table (one row per browser subscription,
scoped). The service worker gains a `push` handler. Client subscribe/unsubscribe UI + a `webpush` rule
channel option. Delivery is best-effort (dead-subscription pruning on 404/410). Go-live: generate the
VAPID keypair (done), put `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` in the server `.env`, ship the public
key to the client build.
