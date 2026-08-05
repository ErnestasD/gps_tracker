# Audit findings that are FOUNDER decisions, not code defects

> **Status 2026-08-04:** all eight DECIDED. See each section for the answer and its consequence.

Everything in `backend-audit-remediation.md` marked OPEN is something I can fix. These are the ones
I should **not** decide alone: the code is doing what it was told to do, and changing it changes the
product, the price, or a promise to a customer. Each one names the concrete choice.

---

## 1. `sso` and `dataResidency` are sold but do not exist

`packages/shared/src/plans.ts` grants both entitlements on the Enterprise tier. Nothing in the
codebase reads them — there is no SSO code path and no residency routing. A customer on that plan is
paying for two features that are not implemented.

**The choice:** (a) build them, (b) remove them from the plan matrix and the pricing page, or
(c) keep them listed as "roadmap" with an explicit date. Today the site does not sell them (the
honesty pass removed those claims), so the exposure is limited to the plan matrix itself — but a
sales conversation that reads the matrix would promise them.

**DECIDED (b)** — both flags removed from the plan matrix 2026-08-04. Enterprise stays a
quote-based tier (all TSP plans are already `deviceLimit: null`, so a custom 5000-device deal needs
no code). Re-add each flag together with its implementation, never before.

---

## 2. Account timezone is hard-coded to UTC on self-serve signup, with no UI to change it

`apps/api/src/routes/signup.ts` creates every Direct-plan account with `timezone: 'UTC'`, and no
screen exposes it. Reports bucket rows by the account timezone (hard rule 7), so a Lithuanian fleet's
"yesterday" report currently runs 00:00–24:00 UTC — three hours off in summer. Trips that straddle
03:00 local land in the wrong day.

**DECIDED (c)** — done 2026-08-04. Signup sends the browser's IANA zone, Settings gains an
explicit **Reporting time zone** control (tenant admins), and the existing display-preference picker
now says in words that it only changes rendering. Zones are validated against the runtime tz
database, because a name `Intl` cannot resolve would throw at every report render.

The trap worth remembering: Settings ALREADY had a time-zone picker, but it was the display
preference. A customer could set it, watch every timestamp go local, and still get reports cut on
UTC midnight — a control that looks like it works is worse than no control.

---

## 3. Retention covers `positions` and `webhook_deliveries` only

`trips` and `events` have **no retention at all** and keep precise location history (trip start/end
coordinates, geofence names) indefinitely. The privacy policy says 13 months.

**The choice:** this is a legal/GDPR question, not an engineering one. Either the policy changes to
match reality, or the code changes to match the policy. I can implement whichever, but the retention
period for derived data is your call — and it has a real product cost, because "show me last year's
mileage" stops working past the horizon.

**My recommendation:** match the policy (13 months) for `events`, and keep `trips` longer but strip
the coordinates past 13 months — a trip's distance and duration are business records, its exact route
is personal data. That distinction needs your sign-off because it is the kind of thing a DPA
addendum gets quoted on.

---

## 4. Overage is reported the instant a day closes, while `usage_daily` keeps filling for 48 h

A device buffering offline reports its device-days late. The daily Stripe job submits `now − 24 h`
once and never backfills, so every late device-day is silently never billed. Asset trackers that
report once a day, or vehicles in a garage over a weekend, are exactly the fleets this under-bills.

**The choice:** (a) delay the report by 48 h (revenue is correct, invoices lag two days), (b) report
daily and submit a catch-up delta for the previous window, or (c) accept the loss as a rounding
error. (b) is the most correct and the most code.

**This one is money, so I want your call before touching it** — the audit rated it HIGH but the
direction is a billing-policy decision, not a bug fix.

---

## 5. Public signup returns a distinct `409 email_in_use`

That is an unauthenticated, platform-wide oracle for whether an email has an Orbetra account. Every
serious signup flow faces this trade-off: a generic response protects the enumeration, but a user who
genuinely forgot they had an account gets a confusing dead end.

**The choice:** (a) keep the clear 409 (better UX, leaks membership), or (b) always return 201 and
send an email that says either "here's your account" or "you already have one, here's a reset link".
(b) is the industry-standard answer and costs about half a day.

---

## 6. TFT100 / FMP100 ingest but have no AVL dictionary

Those devices connect and their positions are stored, but their IO elements land as `io_<id>` with no
names, so rules and the UI cannot use them meaningfully.

**The choice:** whether these models are actually in scope for launch. If yes, someone has to
transcribe their AVL ID tables from the Teltonika wiki (a day of careful, citation-checked work per
model — hard rule 8 means no guessing). If no, the device profile should refuse them at onboarding
rather than half-working.

---

## 7. OSRM is loaded with Lithuania only

Route-snapped distances work for LT and silently fall back to great-circle everywhere else. A Polish
or German customer gets less accurate mileage with no indication why.

**DECIDED: Mapbox for routing, and the OSRM expansion is cancelled.** (ADR-034)

The reasoning changed twice and it is worth recording why, because the first two answers were
optimising the wrong thing.

First I costed OSRM coverage and recommended expanding it. Then Mapbox's 12-coordinate limit turned
up and I recommended keeping OSRM to protect the 50-stop capability. Then we actually looked at the
screen: route planning is a **side feature of a tracking product**, it takes raw `lat,lon` pairs
that no courier has, it shipped labelled *"pilot coverage: Lithuania"*, and nobody uses it. Twelve
stops is more than enough for the customers this product is for — vehicles, theft alerts, speeding —
and I had been about to recommend an irreversible server upgrade to defend a number no one asked
for.

The rest of this section is the costing that led there; it stands as the record.

The costing settled it. At the modelled scale (10 direct customers × 4 devices + one small
white-label ≈ 90 devices, ~30 users) full Mapbox is **$0/month**: map loads ~10k against a 50k free
tier, optimization ~2k against 100k. It only becomes a real line item at roughly 1,000 devices and
300 users (~$1,000/month), which is a problem worth having.

So routing moves to the Mapbox Optimization API — worldwide coverage today, no per-country extracts,
no quarterly rebuilds, no disk. OSRM comes back when there is revenue to justify a bigger box, and
because both sit behind a `RoutingDriver` interface, that migration is an env variable rather than a
rewrite.

**Geocoding deliberately stays on Photon.** This is where Mapbox's terms bite: *temporary*
geocoding is free but the result may NOT be stored, and *permanent* geocoding has no free tier at
all ($5/1,000, ≈$110/month at the modelled scale). Choosing the free tier would mean historical
trips have no stored address — and if we later moved to Photon, those addresses would simply never
have existed. Photon is already deployed, costs nothing, and lets us store. The one irreversible
data decision in the whole comparison, so it goes the safe way.

Two consequences to remember: OSRM and Mapbox use different routing engines, so mileage will shift
by a few percent at the migration (visible to any customer who uses mileage for reimbursement), and
the marketing site's "self-hosted routing" claim comes out now and goes back in later.

---

## 8. Photon is deployed but nothing reads `GEOCODER_URL`

Reverse geocoding is running as a container and costing memory, but no code path calls it — addresses
are never resolved anywhere in the product.

**The choice:** wire it up (it is genuinely useful — "where was this vehicle" reads far better as a
street than as coordinates) or shut the container down. Right now we pay for it and get nothing.

**My recommendation:** wire it up. It is a small change and it is the single biggest perceived-quality
difference between us and a hobby tracker.
