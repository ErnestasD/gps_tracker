# ADR-024: Stripe for subscription billing (per-device metered)

**Status:** Accepted · **Date:** 2026-07-14 · **Deciders:** founder (unblocked with test keys), autonomous session

## Context

PROJECT_PLAN §12 pillar 5 sets **transparent per-device pricing €1.5–2.5/device/mo**; §8 W7-S4 lists
*Stripe metered billing* (V1-NICE). Metering source already exists: `usage_daily` → the usage repo's
`tenantSummary` gives per-tenant **device-days** (E07-4). The founder obtained Stripe **test** keys
(`pk_test_`/`sk_test_`) and approved building the billing integration.

We need: a tenant can **subscribe**, **manage** their subscription/cards/invoices, and we can **charge
by device usage** — without card data ever touching our servers (PCI scope = SAQ-A).

## Decision

**Use Stripe Checkout (Stripe-hosted) + the Customer Portal + a metered subscription price**, driven by
the official `stripe` Node SDK (new runtime dependency — this ADR satisfies hard-rule 10).

- **Why Checkout over Elements:** Stripe hosts the payment page, so no card data reaches us (PCI SAQ-A),
  minimal code, native subscription + usage-based support, and we get the **Customer Portal** for free
  (tenants self-manage subscriptions/cards/invoices — we build no billing UI beyond a status page + two buttons).
- **Why the `stripe` SDK (not raw REST via `fetch`):** webhook signature verification
  (`stripe.webhooks.constructEvent`) is security-critical and uses a timing-safe HMAC scheme that must not
  be hand-rolled. The SDK is the canonical, audited implementation. This is the single new runtime dep.
- **Billing model:** one **metered/usage-based price** (per device-day). A subscription is created via
  Checkout; a daily job reports each tenant's device-days from `usage_daily` as Stripe meter events
  (see follow-up PR B). Stripe invoices monthly on real usage.

## Architecture (this ADR spans two PRs)

- **PR A — lifecycle (this change):** lazy Stripe **customer** per tenant; `POST /v1/billing/checkout`
  (subscription mode) → hosted URL; `POST /v1/billing/portal` → Customer Portal URL; `GET /v1/billing`
  → status; `POST /v1/webhooks/stripe` (public, **raw body**, signature-verified) persists subscription
  state. Tenant billing state lives on `tenants` (stripeCustomerId, stripeSubscriptionId,
  subscriptionStatus, currentPeriodEnd). The Stripe client is **injected** (`ApiDeps.stripe`), so tests
  use a fake and no network/keys are needed; when `STRIPE_SECRET_KEY` is unset the billing routes return
  **503 billing_not_configured** (staging/CI run without keys).
- **PR B — metering:** a worker cron pushes yesterday's device-days per subscribed tenant to Stripe as
  meter events.

## Security / invariants

- **Webhook is the ONLY trusted source of subscription state.** The browser never tells us "I paid" — we
  set `subscriptionStatus` solely from signature-verified webhook events (`checkout.session.completed`,
  `customer.subscription.updated|deleted`, `invoice.payment_failed`). An invalid signature → 400, no state change.
- **Idempotent webhook**: events carry a stable id; a processed-event guard (Redis SETNX) drops replays.
- **Tenant isolation (rule 2 / §10 #7):** billing routes derive the tenant from `auth.tenantId`, never a
  path param (like the E03-5 tenant-self routes); webhook lookups are by `stripeCustomerId` inside a
  packages/db repo method. `/v1/billing` + `/v1/webhooks` are isolation-suite EXEMPT (no cross-tenant :id surface).
- **Secrets (rule 12):** `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_ID` live only in the
  server `.env` — never git. Test keys are safe to build against; **live** keys go straight to the server.

## Alternatives considered

- **Payment Links** — too primitive; no per-tenant/usage binding.
- **Elements (embedded)** — full custom payment UI, more code + more PCI surface; overkill for V1.
- **Raw REST via fetch** — rejected: re-implementing webhook signature verification is a security anti-pattern.

## Consequences

New runtime dep `stripe` (apps/api). Billing is env-gated: absent keys ⇒ routes 503, everything else runs.
Follow-up (PR B) wires the metered usage push. Affiliate commission (§6.9) can later move from the
pre-Stripe `usage_daily × plan` computation to Stripe's collected-revenue events (§6.9 V2).
