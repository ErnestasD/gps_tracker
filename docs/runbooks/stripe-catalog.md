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
| TSP Grow | price_1TtAmkDn0hX6WL8dq9DzMnGj | price_1TtAmkDn0hX6WL8dFDPl7wdZ | price_1TtAnFDn0hX6WL8difV7NZwx (€0.40) |
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
  | TSP Grow | price_1TtBZDDn0hX6WL8dMdqdzzP7 | €0.01333 | €0.40 |
  | TSP Scale | price_1TtBZDDn0hX6WL8d4U4rlRyN | €0.011667 | €0.35 |
- The worker reports via the SDK `stripe.billing.meterEvents.create({ event_name, payload: { value, stripe_customer_id }, timestamp })`.

## PR B2 env maps (base → overage / included)
```
STRIPE_OVERAGE_MAP=price_1TtAmhDn0hX6WL8dNH1SVNyT:price_1TtBZCDn0hX6WL8dvUMBElCR,price_1TtAmiDn0hX6WL8dTT0Ki7Hv:price_1TtBZCDn0hX6WL8dvUMBElCR,price_1TtAmkDn0hX6WL8dq9DzMnGj:price_1TtBZDDn0hX6WL8dMdqdzzP7,price_1TtAmkDn0hX6WL8dFDPl7wdZ:price_1TtBZDDn0hX6WL8dMdqdzzP7,price_1TtAmmDn0hX6WL8dTgThzpEU:price_1TtBZDDn0hX6WL8d4U4rlRyN,price_1TtAmmDn0hX6WL8dnmyBGbFy:price_1TtBZDDn0hX6WL8d4U4rlRyN
STRIPE_INCLUDED=price_1TtAmhDn0hX6WL8dNH1SVNyT:200,price_1TtAmiDn0hX6WL8dTT0Ki7Hv:200,price_1TtAmkDn0hX6WL8dq9DzMnGj:750,price_1TtAmkDn0hX6WL8dFDPl7wdZ:750,price_1TtAmmDn0hX6WL8dTgThzpEU:2500,price_1TtAmmDn0hX6WL8dnmyBGbFy:2500
```
(TSP base monthly+yearly both map to the same overage price + included count.)

## `STRIPE_PRICES` allowlist (the 16 subscribable base/flat prices)
```
price_1TtAmYDn0hX6WL8d8xxAMGq1,price_1TtAmZDn0hX6WL8d4qBJ1GgM,price_1TtAmaDn0hX6WL8d1SOxJP5e,price_1TtAmbDn0hX6WL8dd7Q4hDaQ,price_1TtAmcDn0hX6WL8dAklBgPtS,price_1TtAmcDn0hX6WL8dzGWI0i93,price_1TtAmeDn0hX6WL8d7xyIUN85,price_1TtAmeDn0hX6WL8dj2qcwO5d,price_1TtAmgDn0hX6WL8dwuKbOe92,price_1TtAmgDn0hX6WL8ddo1HSkE7,price_1TtAmhDn0hX6WL8dNH1SVNyT,price_1TtAmiDn0hX6WL8dTT0Ki7Hv,price_1TtAmkDn0hX6WL8dq9DzMnGj,price_1TtAmkDn0hX6WL8dFDPl7wdZ,price_1TtAmmDn0hX6WL8dTgThzpEU,price_1TtAmmDn0hX6WL8dnmyBGbFy
```
Overage prices are added as a **2nd subscription line item** in PR B (a metered price is not a standalone subscription target), not in this allowlist.

## Still needed to go live on staging (founder / follow-up)
1. A **webhook endpoint** in Stripe → `https://<staging>/v1/webhooks/stripe`, subscribed to `customer.subscription.*`; copy its `whsec_…` → server `.env` `STRIPE_WEBHOOK_SECRET`.
2. Server `.env`: `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_PRICES=<above>`, `APP_BASE_URL=https://<app>`.
3. PR B: plan-picker UI + the daily meter-event usage push.
