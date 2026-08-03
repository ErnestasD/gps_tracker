# Lovable prompt — Orbetra public site, iteration 2 (against the current `orbetra_frontend`)

> This is a **delta** prompt: the colleague already delivered a good Lovable pass (in `orbetra_frontend`).
> Paste **PART B** into Lovable — it tells Lovable to EDIT the existing project, keep what's good, and
> fix the remaining gaps. PART A is context/decisions for Ernestas.
>
> **Decisions locked with Ernestas:** (1) positioning = **light direct‑lean** — direct small fleets stay
> the primary track, white‑label is a strong *equal‑weight second track* (not a footnote); (2)
> **"Start free trial" becomes a REAL self‑serve signup** — Ernestas is building `POST /v1/public/signup`;
> wire the `/signup` page to it.

---

## PART A — What the current build got right, and what still needs work

**Already good (KEEP — do not regress):**
- The dark **Midnight Cyan** design system is intact (bg `#04070F`, indigo `#4c4dcf`, amber `#B45309`,
  Space Grotesk / Inter / JetBrains Mono). Keep it exactly.
- The hero console now rotates **real screenshots** (`src/assets/hero/{map,index,events,geofences,
  reports}.png`) — great, keep this pattern and reuse real screenshots elsewhere.
- **Pricing already shows both tracks with real numbers**: Direct per‑vehicle (5→€9, 10→€15, 25→€35
  "Popular", 50→€65, 100→€119, monthly/annual toggle) and TSP (Start €149/200, Grow €399/750, Scale
  €899/2500, Enterprise) + a Direct‑vs‑TSP comparison table. Keep all of it.
- `LiveDemoFab` linking to the interactive `/app` demo — keep; we'll point it at the real read‑only demo.

**Still to fix (this iteration):**
1. **Positioning is now direct‑*tilted*, not balanced.** The hero ("GPS for small fleets · 1–20
   vehicles", "Know where every van is") and especially `/tsp` ("Orbetra's **main product** is a tracking
   app for small fleets … this page is for TSPs") subordinate white‑label. Target = **light direct‑lean
   but with white‑label as a genuine equal second track** (see PART B §1).
2. **False map claim (honesty).** The homepage TrustBand still says *"Open geodata — OpenStreetMap tiles,
   no US map vendors in your stack."* This is wrong twice: the real app uses **Mapbox**, and the site's
   own maps render **Carto** (US vendor) tiles. Must be corrected.
3. **Fabricated product data** still fills `TabShowcase` + `CodeCard` (24,812 km, 1,204 events, fake IMEI
   `353173094`, VINs, "132 devices"). Replace with real screenshots / honest generic data.
4. **No cookie consent, no `/cookies` page.**
5. **No mobile menu** (navbar is `hidden md:flex`; phones show only logo + button).
6. **Language switcher is non‑functional** (EN/PL/DE/LT buttons do nothing; no i18n framework).
7. **Missing pages**: partner/affiliate program + partner login/dashboard, `/signup`, `/demo`, and
   optionally `/fleets`, `/features`, `/devices`, `/use-cases`, `/about`, `/contact`. `/docs` is a dead
   link.
8. **Legal pages** are `TODO-LEGAL` stubs; **domain** is inconsistent (`orbetra.eu` on the site vs
   `orbetra.com` in the Impressum).
9. **"Start free trial"** points to `/pilot` (a lead form). It must point to the new real **`/signup`**.

**Backend Ernestas is building in parallel (so Lovable can wire to it):**
- `POST /v1/public/signup` (real self‑serve trial: creates the account, carries `?ref`) → the `/signup`
  page submits here.
- Partner self‑service is already live: `POST /v1/partner/login`, `POST /v1/partner/set-password`,
  `GET /v1/partner/me`, `GET /v1/partner/commissions` (Bearer token, no cookie).
- A public read‑only **live demo** (for the `LiveDemoFab` / `/demo` CTA) — Ernestas will supply
  `VITE_DEMO_URL`.

**Honesty guardrails (keep in all copy):** we use **Mapbox** tiles → never claim self‑hosted maps or "no
US map vendors"; do claim **self‑hosted geocoding (Photon) + routing (OSRM)**. Never "tamper‑proof"
(identity is IMEI‑based). Fuel = **level monitoring**, not theft alerting. SSO + regional data‑residency
*entitlement* + 99.9% SLA are **Scale/Enterprise only** (physical EU hosting is for everyone). No
historical import in v1 (TSPs migrate in **shadow mode**, not "import your history").

---

## PART B — PROMPT FOR LOVABLE (edit the existing `orbetra_frontend` project)

You are iterating on the existing **Orbetra** marketing site (this project). **Keep the current dark
"Midnight Cyan" design system, the real hero screenshots, and the two‑track pricing page exactly as they
are.** Make the targeted changes below. Domain is **orbetra.com** — normalise every `orbetra.eu`
reference (emails, api., app.) to `orbetra.com`.

### 1) Rebalance positioning to a *light direct‑lean with an equal‑weight white‑label track*
Keep direct small fleets as the primary voice, but stop subordinating white‑label. Concretely:
- **Hero**: keep the direct headline, but broaden the eyebrow and sub so a reseller also sees themselves.
  Eyebrow → `TELTONIKA GPS · FOR FLEETS & RESELLERS · EU‑HOSTED`. Keep H1 "Know where every van is. /
  Down to the minute." Add one sentence to the sub: *"…no IT team required. Running a tracking business?
  White‑label the whole platform under your brand."* Keep primary CTA **"Start free trial"** (now →
  `/signup`, see §2) + ghost **"See pricing"**, and make the existing white‑label chip a proper **second
  CTA/link "White‑label it →"** (→ `/tsp`) so both audiences have a first‑class action in the hero.
- Add a compact **"Two ways to use Orbetra"** band right below the hero: two equal cards — **"Run your
  own fleet"** (1–100 vehicles, Orbetra‑branded, self‑serve → "Start free trial") and **"Resell it as
  your own"** (uncapped, your brand + domain, sub‑accounts, shadow‑mode migration → "White‑label
  platform"). Two equal glass cards, same visual weight.
- **`/tsp`**: remove the line calling the direct app "the main product" / "this page is for TSPs". Reframe
  as a confident parallel track: *"Orbetra is two products in one: a tracking app for your own fleet, and
  a white‑label platform to resell under your brand. This is the reseller track."* Keep the rest (brand +
  domain + sub‑accounts + shadow‑mode migration + partner economics + the €149 vs Wialon €300–500 point).

### 2) Wire "Start free trial" to a real self‑serve signup
- Add a **`/signup`** page (dark theme, same style): fields name, work email, password, optional company;
  carry the `?ref=` code (from the `tc_ref` cookie) as a hidden field. Submit `POST
  {VITE_API_URL}/v1/public/signup` `{ name, email, password, company?, ref? }`. Show success ("Check your
  email / You're in") and error states. Add a "Already have an account? Sign in" link (→ the app).
- Point every **"Start free trial" / "START TRIAL"** CTA (navbar, hero, pricing direct cards, final CTA)
  at **`/signup`** (not `/pilot`). `/pilot` stays for the TSP/enterprise "Request a pilot" / "Talk to
  partnerships" flow.

### 3) Fix the false map claim (honesty)
- Replace the homepage TrustBand item **"Open geodata — OpenStreetMap tiles, no US map vendors in your
  stack."** with **"Self‑hosted geocoding & routing — Photon + OSRM, EU‑hosted."** Keep the "© OpenStreetMap
  contributors" attribution only where OSM data is actually shown. Do not claim self‑hosted map tiles
  anywhere.

### 4) Replace fabricated product data with honest visuals
- The **`TabShowcase`** "Everything you need" section and **`CodeCard`** still use invented data (24,812
  km, 1,204 events, fake IMEI `353173094`, VINs, "132 devices"). Replace the fake dashboards with the
  **real screenshots** already in `src/assets/hero/*` (add more captures as needed — a
  `/public/screenshots/` folder Ernestas can fill), OR keep the interactive components but make the data
  **obviously generic** ("YOUR‑FLEET‑01", "—", "12 vehicles") so nothing reads as a real customer stat.
  In `CodeCard`, use a placeholder id like `"<device-id>"`, not a real‑looking IMEI. Remove every
  invented metric/VIN/name across `TabShowcase`, `CodeCard`, `VerticalsGrid`, `StatTile`.

### 5) Cookie consent + `/cookies`
- Add a first‑visit **cookie‑consent banner** (honest, light): *"Orbetra uses minimal cookies — essential
  ones to run the site, and one optional cookie to credit a partner referral. Analytics is cookieless."*
  Buttons **"Accept" / "Reject non‑essential" / "Preferences"**; persist the choice; gate the affiliate
  `tc_ref` cookie behind consent. Link to a new **`/cookies`** policy page (list each cookie, purpose,
  duration).

### 6) Mobile navigation
- Add a working **hamburger + slide‑over drawer** for the navbar on mobile (all nav links + "Start free
  trial" + "Sign in"). Keep the amber active‑link underline on desktop.

### 7) i18n — make the language switcher real (EN / PL / DE / LT)
- Wire an actual i18n framework (e.g. `react-i18next`): extract copy to locale files, make the navbar +
  footer **EN/PL/DE/LT** switcher functional with `localStorage` + browser‑language detection, default EN.
  If full translation is too much this pass, at least wire the framework + switcher and translate the
  **home, pricing, nav, footer**; leave PL/DE/LT keys ready for Ernestas to fill. (Target markets: Poland,
  Germany, the Baltics.)

### 8) New pages
- **`/partners`** — the affiliate/partner program: what it is (invite‑only), **recurring commission for a
  limited time**, how a `?ref=` link credits a signup, a **"Become a partner"** application form (→
  `POST {VITE_API_URL}/v1/public/pilot-request` with a `partnerApplication:true` flag for now), and a
  **"Partner sign in"** link → `/partner/login`.
- **`/partner/login`**, **`/partner/set-password`**, **`/partner/dashboard`** — partner self‑service over
  the live backend: `POST /v1/partner/login {email,password}` → `{accessToken}` (store in memory, no
  cookie; no refresh — on expiry return to `/partner/login`); `POST /v1/partner/set-password
  {token,password}`; `GET /v1/partner/me`; `GET /v1/partner/commissions`. Dashboard shows the partner's
  **referral code + shareable link**, their **rate & window**, and **commission history** (pending/paid).
  Same dark theme.
- **`/demo`** — a page that launches the read‑only **Live demo** (button → `VITE_DEMO_URL`, "no signup,
  read‑only"). Keep the `LiveDemoFab` but point it here / at `VITE_DEMO_URL`.
- **Fix `/docs`** — either remove the dead nav/footer link or point it at the app's API docs
  (`{VITE_API_URL}/v1/docs`).
- *Optional, if time allows* (SEO + clarity, same style): **`/features`** (full capability overview),
  **`/devices`** (supported Teltonika models: FMB / FMC / FMB6xx / TAT / TFT100 / FMP100), **`/use-cases`**
  (fleet ops, logistics, construction, agriculture, equipment rental, cold chain), **`/about`** (MB
  Dokigo), **`/contact`** (email hello@orbetra.com + form + Impressum details).

### 9) Legal
- Fill **Privacy / Terms / DPA / Subprocessors / Impressum** with real first‑draft content (Ernestas will
  have a lawyer review) — no visible `TODO-LEGAL` on the live site. Impressum: MB Dokigo, Krivių g. 5,
  LT‑01204 Vilnius, company code 307575857, director Ernestas Dubovskich, hello@orbetra.com.

### Honesty guardrails (apply to all copy)
Mapbox tiles → never "self‑hosted maps" / "no US vendors"; do say self‑hosted **geocoding (Photon) +
routing (OSRM)**. Never "tamper‑proof". Fuel = **level monitoring**, not theft. SSO / regional
data‑residency entitlement / 99.9% SLA = **Scale & Enterprise only**. TSP migration = **shadow mode**, not
data import. Capabilities that ARE shipped and safe to feature: live tracking, trips & playback,
geofences (polygon/circle/corridor), rules & alerts (overspeed, geofence, ignition, digital‑input,
power‑cut, low‑battery, panic, device‑offline), reports (trips/mileage/stops/overspeed/geofence/
engine‑hours) with CSV/XLSX/PDF + scheduled email, fuel level graph, drivers + scoring, maintenance
reminders, Codec‑12 commands, CAN & device health, SMS onboarding, webhooks, REST API + keys, GDPR
export/erase + 13‑month EU retention, share links, roles + multi‑tenant accounts, and full white‑label
(logo/colors/name, custom domains + auto TLS, branded login + emails, sub‑accounts). App UI ships in
EN/PL/LT/DE.
