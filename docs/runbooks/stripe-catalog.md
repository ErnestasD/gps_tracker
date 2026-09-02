# Stripe catalog (TEST mode) — Orbetra

Created from `PRICING_STRATEGY.md` §7 in the Stripe **test** account `acct_1Tt8bGDn0hX6WL8d` (LT / EUR)
on 2026-07-14. Price ids are **not secrets** (only `sk_…`/`whsec_…` are) — safe to commit. Re-create in
live mode before launch (new ids). The catalog script lives in the session scratchpad; prices carry
stable `lookup_key`s, so re-running is idempotent.

## Track A — Direct (flat per-device tiers)
| Plan | lookup_key (monthly / yearly) | price id monthly | price id yearly |
|---|---|---|---|
| Direct 5 | direct_5_monthly / direct_5_yearly | price_1TtAmYDn0hX6WL8d8xxAMGq1 | price_1TtAmZDn0hX6WL8d4qBJ1GgM |
| Direct 10 | direct_10_* | price_1TtAmaDn0hX6WL8d1SOxJP5e | price_1TtAmbDn0hX6WL8dd7Q4hDaQ |
| Direct 25 | direct_25_* | price_1TtAmcDn0hX6WL8dAklBgPtS | price_1TtAmcDn0hX6WL8dzGWI0i93 |
| Direct 50 | direct_50_* | price_1TtAmeDn0hX6WL8d7xyIUN85 | price_1TtAmeDn0hX6WL8dj2qcwO5d |
| Direct 100 | direct_100_* | price_1TtAmgDn0hX6WL8dwuKbOe92 | price_1TtAmgDn0hX6WL8ddo1HSkE7 |

## Track B — TSP (flat base + metered overage)
| Plan | base monthly | base yearly | overage (metered, €/device) |
|---|---|---|---|
| TSP Start | price_1TtAmhDn0hX6WL8dNH1SVNyT | price_1TtAmiDn0hX6WL8dTT0Ki7Hv | price_1TtAnEDn0hX6WL8duCLPcryR (€0.60) |
| TSP Grow | price_1TtAmkDn0hX6WL8dq9DzMnGj | price_1TtAmkDn0hX6WL8dFDPl7wdZ | price_1TtAnFDn0hX6WL8difV7NZwx (€0.40, deactivated) |
| TSP Scale | price_1TtAmmDn0hX6WL8dTgThzpEU | price_1TtAmmDn0hX6WL8dnmyBGbFy | price_1TtAnFDn0hX6WL8d9j8AL1fV (€0.35) |

## Metered overage meter + PER-DEVICE-DAY prices (PR B2)
- **meter id:** `mtr_test_61V2YkalpCiYMh1EA41Dn0hX6WL8dSVU`
- **event_name:** `orbetra_device_overage` · aggregation `sum` · value key `value` · customer mapping `by_id` → `stripe_customer_id`
- The overage prices were **recreated at a PER-DEVICE-DAY decimal rate** (monthly rate ÷ 30) so that
  reporting a daily excess-device value sums, over the period, to device-days of overage — matching the
  price unit (the earlier flat monthly-rate prices are DEACTIVATED; a flat price would ~30× over-bill):
  | Plan | overage price id (per-device-day) | €/device-day | (= €/device-month) |
  |---|---|---|---|
  | TSP Start | price_1TtBZCDn0hX6WL8dvUMBElCR | €0.0200 | €0.60 |
  | TSP Grow | **price_1UBFXsDn0hX6WL8dzwXWH1Lt** | €0.0166667 | **€0.50** |
  | TSP Scale | price_1TtBZDDn0hX6WL8d4U4rlRyN | €0.011667 | €0.35 |

### Grow overage raised €0.40 → €0.50 (2026-09-02)

A Stripe Price's amount is **immutable**, so this is a new price, not an edit:
`price_1TtBZDDn0hX6WL8dMdqdzzP7` (€0.01333/device-day) is **deactivated** and
`price_1UBFXsDn0hX6WL8dzwXWH1Lt` (€0.0166667/device-day) takes its `tsp_grow_overage_daily`
lookup key via `transfer_lookup_key`. No subscription referenced the old price when it was
archived (checked), so nothing is mid-flight on the old rate.

**The rate is per device-DAY.** €0.50/device-month ÷ 30 = €0.0166667 = `unit_amount_decimal`
`1.6667`. Creating this as a flat `0.50` would over-bill ~30×, which is the mistake this section
already records having shipped once.

Why: the allowance change below drops Grow's effective base to €399 ÷ 1,000 = €0.40 — exactly the
old overage rate. See PRICING_STRATEGY.md §3 for the rule (overage must stay above the effective
base on every tier).
- The worker reports via the SDK `stripe.billing.meterEvents.create({ event_name, payload: { value, stripe_customer_id }, timestamp })`.

## PR B2 env maps (base → overage / included)
```
STRIPE_OVERAGE_MAP=price_1TtAmhDn0hX6WL8dNH1SVNyT:price_1TtBZCDn0hX6WL8dvUMBElCR,price_1TtAmiDn0hX6WL8dTT0Ki7Hv:price_1TtBZCDn0hX6WL8dvUMBElCR,price_1TtAmkDn0hX6WL8dq9DzMnGj:price_1UBFXsDn0hX6WL8dzwXWH1Lt,price_1TtAmkDn0hX6WL8dFDPl7wdZ:price_1UBFXsDn0hX6WL8dzwXWH1Lt,price_1TtAmmDn0hX6WL8dTgThzpEU:price_1TtBZDDn0hX6WL8d4U4rlRyN,price_1TtAmmDn0hX6WL8dnmyBGbFy:price_1TtBZDDn0hX6WL8d4U4rlRyN
STRIPE_INCLUDED=price_1TtAmhDn0hX6WL8dNH1SVNyT:300,price_1TtAmiDn0hX6WL8dTT0Ki7Hv:300,price_1TtAmkDn0hX6WL8dq9DzMnGj:1000,price_1TtAmkDn0hX6WL8dFDPl7wdZ:1000,price_1TtAmmDn0hX6WL8dTgThzpEU:3500,price_1TtAmmDn0hX6WL8dnmyBGbFy:3500
```
(TSP base monthly+yearly both map to the same overage price + included count.)

**Allowances raised 2026-09-02: 200 → 300 · 750 → 1,000 · 2,500 → 3,500.** These live ONLY in this
env var — there is no plan catalogue in code to change, and `overageDevices(active, included) =
max(0, active − included)` already implements the rule. A day at or under the allowance records
`reported: 0` locally and sends nothing to Stripe, which on a summing meter is the same as sending
zero. **Updating this variable is the whole of the metering change**, so a deploy that forgets it
keeps billing against the old, smaller allowances.

## ⚠️ Stripe Tax is NOT active in this account (found 2026-09-02)

`tax.settings` reports `status: pending` (`missing_fields: ["head_office"]`), `defaults.tax_behavior`
is unset, and **every price in this catalogue — Track A and Track B, base and overage — carries
`tax_behavior: unspecified`.** PRICING_STRATEGY.md §7 states `tax_behavior = exclusive`; that is the
intent, not the current state.

As it stands a checkout would charge the listed amount with **no VAT added**, while the pricing page
promises "all prices exclude VAT". Deliberately NOT changed here: `tax_behavior` is a one-way
transition per price (`unspecified` → `exclusive` is allowed, back is not), it affects Track A which
this pricing revision does not touch, and activating Stripe Tax needs a head-office address — an
account and legal decision, not a code one. **Pre-launch checklist item.**

## `STRIPE_PLAN_MAP` (base → tenant plan) — the one that was missing

**This variable was absent from this runbook until 2026-08-13, and therefore absent from the
server.** `planFor` then returns undefined for every price, so a successful checkout never writes
the tenant's plan: the customer is billed in full and silently keeps the TRIAL entitlements — no API
access, no SMS gateway, no white-label. Stripe reports success, the webhook returns 200, and nothing
anywhere says otherwise. It must also be listed in the **api** service env map in
`infra/compose/docker-compose.apps.yml`, or it never reaches the process (audit 2026-08-13, PR #202).

Every price in the `STRIPE_PRICES` allowlist needs an entry — both the monthly and the yearly id of
a tier map to the same plan. An unknown plan string is dropped by the parser rather than written,
so a typo fails the same silent way as omission.

```
STRIPE_PLAN_MAP=price_1TtAmYDn0hX6WL8d8xxAMGq1:direct_5,price_1TtAmZDn0hX6WL8d4qBJ1GgM:direct_5,price_1TtAmaDn0hX6WL8d1SOxJP5e:direct_10,price_1TtAmbDn0hX6WL8dd7Q4hDaQ:direct_10,price_1TtAmcDn0hX6WL8dAklBgPtS:direct_25,price_1TtAmcDn0hX6WL8dzGWI0i93:direct_25,price_1TtAmeDn0hX6WL8d7xyIUN85:direct_50,price_1TtAmeDn0hX6WL8dj2qcwO5d:direct_50,price_1TtAmgDn0hX6WL8dwuKbOe92:direct_100,price_1TtAmgDn0hX6WL8ddo1HSkE7:direct_100,price_1TtAmhDn0hX6WL8dNH1SVNyT:tsp_start,price_1TtAmiDn0hX6WL8dTT0Ki7Hv:tsp_start,price_1TtAmkDn0hX6WL8dq9DzMnGj:tsp_grow,price_1TtAmkDn0hX6WL8dFDPl7wdZ:tsp_grow,price_1TtAmmDn0hX6WL8dTgThzpEU:tsp_scale,price_1TtAmmDn0hX6WL8dnmyBGbFy:tsp_scale
```

`tsp_enterprise` has no entry on purpose: it is sales-led and has no self-serve price.

## `STRIPE_PRICES` allowlist (the 16 subscribable base/flat prices)
```
price_1TtAmYDn0hX6WL8d8xxAMGq1,price_1TtAmZDn0hX6WL8d4qBJ1GgM,price_1TtAmaDn0hX6WL8d1SOxJP5e,price_1TtAmbDn0hX6WL8dd7Q4hDaQ,price_1TtAmcDn0hX6WL8dAklBgPtS,price_1TtAmcDn0hX6WL8dzGWI0i93,price_1TtAmeDn0hX6WL8d7xyIUN85,price_1TtAmeDn0hX6WL8dj2qcwO5d,price_1TtAmgDn0hX6WL8dwuKbOe92,price_1TtAmgDn0hX6WL8ddo1HSkE7,price_1TtAmhDn0hX6WL8dNH1SVNyT,price_1TtAmiDn0hX6WL8dTT0Ki7Hv,price_1TtAmkDn0hX6WL8dq9DzMnGj,price_1TtAmkDn0hX6WL8dFDPl7wdZ,price_1TtAmmDn0hX6WL8dTgThzpEU,price_1TtAmmDn0hX6WL8dnmyBGbFy
```
Overage prices are added as a **2nd subscription line item** in PR B (a metered price is not a standalone subscription target), not in this allowlist.

## Still needed to go live on staging (founder / follow-up)
1. A **webhook endpoint** in Stripe → `https://<staging>/v1/webhooks/stripe`, subscribed to
   `customer.subscription.*`, `invoice.payment_succeeded` and `charge.refunded`; copy its `whsec_…`
   → server `.env` `STRIPE_WEBHOOK_SECRET`.

   > The last two drive **affiliate commissions**: `invoice.payment_succeeded` accrues a partner's
   > cut, `charge.refunded` reverses it when the customer gets the money back. Forgetting
   > `charge.refunded` does not break anything visibly — it just leaves commissions owed on sales
   > that were undone, which nobody notices until a payout run.
2. Server `.env`: `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_PRICES=<above>`, `APP_BASE_URL=https://<app>`.
3. PR B: plan-picker UI + the daily meter-event usage push.
