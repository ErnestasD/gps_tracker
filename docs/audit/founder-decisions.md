# Audit findings that are FOUNDER decisions, not code defects

> **Status 2026-08-04:** the founder answered all eight. 1, 2, 3, 4, 5, 6 and 8 are DECIDED and
> being implemented (see each section). **7 (routing coverage) is still open** — it turned into a
> positioning question once it was clear OSRM serves only the stop-order optimizer, and the site
> currently advertises self-hosted routing.

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

**The choice:** load more extracts (disk + memory per country, and a rebuild on each), restrict
selling to LT for now, or surface the fallback in the UI so the customer knows. Purely a
cost-vs-market decision.

---

## 8. Photon is deployed but nothing reads `GEOCODER_URL`

Reverse geocoding is running as a container and costing memory, but no code path calls it — addresses
are never resolved anywhere in the product.

**The choice:** wire it up (it is genuinely useful — "where was this vehicle" reads far better as a
street than as coordinates) or shut the container down. Right now we pay for it and get nothing.

**My recommendation:** wire it up. It is a small change and it is the single biggest perceived-quality
difference between us and a hobby tracker.
