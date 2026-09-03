# PRICING_STRATEGY.md — Orbetra
> ## ⚠️ SOURCE OF TRUTH FOR ALL PRICING
> **This document is the single, authoritative source for every pricing number, tier, plan, and billing rule in the Orbetra project.** It overrides any pricing figures mentioned in PROJECT_PLAN.md, PUBLIC_WEB_LOVABLE.md, DASHBOARD_UI_SPEC.md, or any other document. Where those files quote different numbers (e.g. an old "€1.5–2.5/device" range, or "€49/€149/€399" tiers), **those are void — use the tables in this file instead.**
>
> **For Claude Code / agents:** when implementing anything touching prices, plans, tiers, billing, overage, or affiliate commission math, read THIS file, not the pricing lines elsewhere. If another doc conflicts, this wins.
> **For the affiliate module (PROJECT_PLAN §6.9 / E09):** the "plan pricing" used in the commission month-close job = the TSP base + metered overage defined in §2–3 here.
> **For the public site (PUBLIC_WEB_LOVABLE.md):** the pricing page uses the exact numbers in §2–3 here.
>
> All pricing changes go into THIS file only — other docs are already handed to coding agents and must not be edited for pricing.

---

**Status:** market-validated (2026), baseline for launch · **Companion to:** PROJECT_PLAN.md §7
**One-line:** two tracks — **Direct** for small fleets, **White-label/TSP** for resellers. **Both are self-service** (founder decision 2026-09-03; TSP was sales-led until then — see §3). Monthly + annual (2 months free). Per-device economics validated against GpsGate ($1.5/device), Wialon wholesale (~€0.30–0.60), gps-server (~€0.45–1.25), 1NCE SIM (~€0.10/mo).

---

## 1. Positioning
Not "cheapest per device" — **"no minimum pain."** Wialon pushes TSPs to a ~€300–500/mo minimum regardless of size; GpsGate bills a 5-unit minimum. Orbetra's **€149 TSP Start is the lowest serious white-label entry point in the market.** Direct pricing (€1.19–1.80/device) sits at or below GpsGate's $1.5, but with a modern product and Teltonika-native focus.

---

## 2. TRACK A — Direct (small fleets, self-service, Orbetra brand)

| Devices | €/mo | €/device | €/yr (2 mo free) | Effective €/mo (annual) |
|---|---|---|---|---|
| 5 | €9 | €1.80 | €90 | €7.50 |
| 10 | €15 | €1.50 | €150 | €12.50 |
| 25 | €35 | €1.40 | €350 | €29.17 |
| 50 | €65 | €1.30 | €650 | €54.17 |
| 100 | €119 | €1.19 | €1,190 | €99.17 |

Included: live map, trips & playback, geofences & alerts, reports (CSV/XLSX), email support. Single account, **no white-label, no sub-tenants**. Self-service Stripe Checkout, no sales call.
Note: smallest tier is 5 devices (mirrors GpsGate's 5-unit floor; deliberately no 1-device tier to avoid hobbyists eating support). Optional: drop the 5 tier and start at 10 if hobbyist load appears.

## 3. TRACK B — White-label / TSP (resellers, self-service, own brand + sub-tenants)

| Plan | Base €/mo | Included devices | €/device base | Overage/device | €/yr (2 mo free) |
|---|---|---|---|---|---|
| TSP Start | €149 | 300 | €0.50 | €0.60 | €1,490 |
| **TSP Grow** ⭐ | €399 | 1,000 | €0.40 | €0.50 | €3,990 |
| TSP Scale | €899 | 3,500 | €0.26 | €0.35 | €8,990 |
| TSP Enterprise | contact | 3,500+ | custom | custom | custom |

**Revised 2026-09-02 — allowances up, Grow overage up.** Bases and annual prices are unchanged
(€1,490 / €3,990 / €8,990, still exactly 2 months free).

**The rule this enforces: overage must sit ABOVE the effective base rate.** Otherwise a customer is
better off staying under-provisioned and paying overage than moving up a tier, and every device past
the allowance earns less than the ones inside it.

| Plan | Effective base €/device | Overage | Margin over base |
|---|---|---|---|
| TSP Start | €149 ÷ 300 = **€0.497** | €0.60 | 1.21× ✓ |
| TSP Grow | €399 ÷ 1,000 = **€0.399** | €0.50 | 1.25× ✓ |
| TSP Scale | €899 ÷ 3,500 = **€0.257** | €0.35 | 1.36× ✓ |

Grow's overage moved €0.40 → €0.50 because the new allowance drops its effective base to €0.40 —
exactly the old overage, i.e. neutral, which is the one thing an overage rate must never be.

**Worth recording: under the OLD allowances all three were inverted**, not just Grow — €0.60 < €0.745,
€0.40 < €0.532, €0.35 < €0.3596. Overage was cheaper per device than the plan itself across the whole
of Track B, so the allowance increase is what fixes the inversion; the Grow rate change is what keeps
it fixed.

**Tier crossovers** (where base+overage on the lower tier equals the next base):

| From → to | Crossover | Was |
|---|---|---|
| Start → Grow | **717 devices** (149 + 417×0.60 = €399.20) | 617 |
| Grow → Scale | **2,000 devices** (399 + 1,000×0.50 = €899) | 2,000 |

A prospect between 300 and ~717 devices is genuinely cheaper on Start with overage — that is the
ladder working, not a leak, but sales should quote it deliberately rather than default to Grow.

Included: everything in Direct **+ white-label domain & logo, sub-tenants (Accounts), REST API + webhooks, priority support**. Scale adds: SSO, regional data residency, SLA 99.9%, named contact.

**Self-service since 2026-09-03** — same flow as Direct: sign up, pick the plan on the in-app billing
page, pay by card. It was "Request a pilot" before, which turned out to be a *link*, not a mechanism:
every TSP price was already in the server's `STRIPE_PRICES` allowlist, `/v1/billing/checkout` never
distinguished Direct from TSP, and the metered overage line was attached automatically. The pricing
page simply pointed the TSP cards somewhere else.

**Enterprise stays sales-led** — it has no price to check out. Its card still routes to `/pilot`, so
a prospect who wants a conversation before committing has one on the same page.

A note for whoever revisits this: white-label onboarding (custom domain, logo, sub-accounts) is still
setup work. Self-service checkout means the *money* is self-service; it does not mean a TSP customer
lands fully configured. The entitlements unlock immediately on the webhook, which is the part that
matters for them to start.

## 4. Break-even between tracks (no cannibalization)

| Device count | Cheapest Direct | Cheapest TSP | Winner |
|---|---|---|---|
| 15 | €35 (25-tier) | €149 (Start) | **Direct** (4× cheaper) |
| 50 | €65 | €149 | **Direct** |
| 100 | €119 | €149 | **Direct** |
| 150 | — (no tier) | €149 | **TSP** |
| 300 | — | €149 (Start, now included) | **TSP** |
| 1,000 | — | €399 (Grow, now included) | **TSP** |
| 2,500 | — | €399 + 1,500×€0.50 = €1,149 vs €899 (Scale) | **TSP — Scale** |

Crossover ~120–150 devices. Below: Direct is cheaper AND simpler (self-service). Above: only TSP has tiers, plus white-label/sub-tenants. The €149 TSP base is high enough that a small fleet never "drops down" into TSP to save money. Defensive mechanism holds.

## 5. Global rules
- **Annual −17%** (2 months free), both tracks, Monthly/Annual toggle on pricing page (the toggle itself lifts annual conversion — users see "save €X").
- **Pilot:** free 60 days up to 500 devices (shadow mode — NOT a permanent free tier; free tiers attract hobbyists).
- **No setup fee** (entry barrier; migration-from-Wialon ease is a selling point).
- **Prices exclude VAT.** B2B EU reverse-charge via Stripe Tax (VAT ID collected at checkout).
- **V2 add-ons (charge separately later, don't give away now):** fuel-theft detection (~+€0.20/device), video telematics, tachograph/DDD, advanced API rate limits.

## 6. Why these numbers (validation trail, 2026)
- **GpsGate** publishes from **$1.5/device** with a **5-unit minimum** → Direct €1.19–1.80 sits at/below a 15-year incumbent; the 5-tier floor mirrors GpsGate's. ✓
- **Wialon wholesale** ~€0.30–0.60/device + ~€300–500/mo partner minimum → TSP effective €0.26–0.50 (overage €0.35–0.60) is competitive; the €149 base undercuts Wialon's minimum dramatically (the real wedge). ✓
- **SIM cost negligible:** 1NCE €10–12 for **10 years** ≈ €0.10/mo/device → software is the dominant TSP cost; TSP margin is healthy (~78% at 300 devices on **Start**, which now includes them: €1,500 retail − €149 − €30 SIM = €1,321; the same fleet on Grow was ~71%). ✓
- TSP Scale overage set to **€0.35** (not €0.28) — still clearly below Wialon wholesale, +25% margin at high volume vs the earlier draft.

## 7. Stripe setup (Products & Prices)
Each plan needs monthly + yearly Prices. TSP overage = metered Price on top of the base subscription.

**Track A — 5 Products (Direct), each with 2 Prices:**
```
Product "Direct 5"    → price_monthly €9,   price_yearly €90
Product "Direct 10"   → price_monthly €15,  price_yearly €150
Product "Direct 25"   → price_monthly €35,  price_yearly €350
Product "Direct 50"   → price_monthly €65,  price_yearly €650
Product "Direct 100"  → price_monthly €119, price_yearly €1190
```
All `recurring`, currency EUR, tax_behavior = exclusive (Stripe Tax adds VAT / applies reverse-charge).

**Track B — 3 Products (TSP), each with base (monthly+yearly) + metered overage:**
```
Product "TSP Start" → base_monthly €149, base_yearly €1490
                    → overage: metered price €0.60/unit (usage reported daily = devices over 300)
Product "TSP Grow"  → base_monthly €399, base_yearly €3990
                    → overage: metered €0.50/unit (over 1000)   ← raised 2026-09-02 from €0.40
Product "TSP Scale" → base_monthly €899, base_yearly €8990
                    → overage: metered €0.35/unit (over 3500)
TSP Enterprise      → no Stripe product; custom quote/invoice
```
Metering: report `active_devices − included` to the metered subscription item at month close (ties to `usage_daily` from IMPLEMENTATION_PLAN E07-4 / affiliate month-close E09-2). If active ≤ included, report 0.

**Checkout:** Prebuilt Stripe Checkout (per earlier decision); Monthly/Annual toggle on the pricing page swaps which Price is sent. Direct = self-serve checkout link. TSP = created by platform_admin after pilot (or a sales-assisted Checkout session), since TSP onboarding involves white-label setup.

## 8. Open calibration (the one thing still unvalidated)
Everything above is validated against the *market average*. The one input that would sharpen it into channel-optimal: **what the friend's PL/DE channel customers actually pay Wialon/competitors per device, and what minimum squeezes them.** One conversation converts "market-correct" → "channel-optimal." As a launch baseline, these numbers are validated and can ship to the site.

Adjust triggers after first real data:
- If TSP prospects say "our Wialon is €X/device" and €X < €0.50 (Start's effective rate; was €0.75) → revisit TSP base/overage down.
- If Direct self-serve converts poorly at €1.19–1.80 → the friction is likely product/trust, not price (don't cut first; investigate).
- If nobody uses the 5-device Direct tier or it only draws hobbyists → drop it, start Direct at 10.
