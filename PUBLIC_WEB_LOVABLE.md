# PUBLIC_WEB_LOVABLE.md — Marketing Site Brief & Lovable Prompt
**Purpose:** generate the public website (marketing front) in Lovable, matching our app stack so code can live in the monorepo (`apps/site`).
**Design tokens are canonical in DASHBOARD_UI_SPEC.md §1** — this prompt repeats the values; if they ever diverge, the spec wins.
**Tip:** attach 2–3 screenshots of akensys.net (hero, product section) into Lovable as *mood reference* — reference the mood, never copy content, layout verbatim, or their imagery.

---
## COPY-PASTE PROMPT FOR LOVABLE (everything between the lines)
---
Build a production-quality marketing website for **Orbetra** — a white-label GPS tracking platform built specifically for Teltonika devices, sold to telematics service providers (TSPs) and fleet resellers in Poland, Germany and the Baltics.

**Tech constraints (hard):**
- Vite + React 18 + TypeScript + Tailwind + shadcn/ui. NO Next.js, NO CSS-in-JS, NO component libraries beyond shadcn. Allowed extra runtime deps (the ONLY two): **framer-motion** (scroll-driven animation) and **cobe** (lightweight WebGL dotted globe, MIT) — nothing else without asking.
- No paid APIs, no Google Maps/Fonts CDN at runtime (self-host Inter via @fontsource). Map imagery: MapLibre GL with style URL from env `VITE_TILES_STYLE_URL` (OpenFreeMap) OR a pre-rendered dark map SVG/PNG — never Google.
- i18n-ready with i18next: all strings in `src/i18n/en.json`; create empty `pl.json`, `de.json`, `lt.json` mirrors. Language switcher in footer.
- Analytics: self-hosted **Umami** script tag via env `VITE_UMAMI_URL`/`VITE_UMAMI_ID` (cookieless — no consent needed for it). The `tc_ref` affiliate cookie is non-essential: show a one-line consent notice; set the cookie only after accept.
- Forms post JSON to `VITE_API_URL + /v1/public/pilot-request` (fields: name, company, email, phone?, deviceCount, message, `ref` from cookie). On the client, read `?ref=` query param on first visit and store cookie `tc_ref` (60 days) — include it in the form payload.
- Lighthouse targets: Performance ≥ 90, A11y ≥ 95, SEO ≥ 95. Semantic HTML, single H1 per page, meta + OG tags per page, sitemap.xml, robots.txt.
- Visible attribution "© OpenStreetMap contributors" wherever a real map renders.

**Design direction — "living space" aesthetic (reference: attached akensys.net screenshots; adopt the PATTERNS, never copy their logo, illustrations, copy, or brand):**
- Deep-space navy background `#0A0F22` → `#0D1230` subtle vertical gradient, starfield particle layer (tiny dots, 2 depth layers drifting slowly, occasional 1px shooting-star streak every ~8 s), grain-free, no pure black.
- Accent system: primary blue `#4DA3FF`, secondary violet `#7C5CFC` (gradients between them for emphasized words and card headers); success `#34D399`; one deliberate warm pop `#F59E0B` reserved for active tab underlines only.
- Section label pattern everywhere: 24px blue dash + uppercase tracking-[0.2em] muted label (e.g. "— THE PLATFORM"), then an ALL-CAPS two-line display headline where the second line (or key phrase) is blue/gradient. Display font-weight 800, tight tracking.
- Buttons: rounded-full pills — primary = light-blue filled (`#4DA3FF` bg, ink text), secondary = violet filled, ghost = 1px border. Round icon-buttons for carousel arrows.
- Cards: translucent dark surface `rgba(20,28,54,.7)` + 1px `#22304C` border + 16px radius; industry/feature cards get a gradient header band (each vertical its own hue: fleet blue, logistics violet, construction amber, agri green, cold-chain cyan) with a white line-icon chip.
- Device mockups: laptop/phone frames containing REAL dashboard screenshots (placeholder slots — we'll paste actual Orbetra dark-UI shots); ghosted duplicate laptops parallax-floating behind the active one, like the reference.
- Floating hardware illustrations: simple original SVG line-art of a GPS tracker puck, antenna gateway, SIM, cloud, database — scattered at section edges with slow parallax (no photos of real Teltonika products, no manufacturer logos).

**Motion & interactivity spec (the soul of this design — implement all, but never hijack native scroll):**
- **Hero globe (cobe):** dotted dark globe, auto-rotating slowly; rotation speed/phase additionally linked to scroll progress (framer-motion `useScroll` → `useTransform`); 8–10 glowing markers (blue/violet/green) at EU cities with 3–4 animated arcs between them; markers pulse. On scroll past hero, globe sinks and fades (parallax at ~0.5×). Lazy-mount the canvas after first paint; pause rendering when tab hidden or globe off-viewport.
- **Scroll reveals:** every section's label→headline→content staggers in (fade + 24px rise, 0.5 s ease-out, 80 ms stagger) via framer-motion `whileInView` (once: true, margin: -80px).
- **Vertical journey timeline** (How it works section): thin line with dots; a small vehicle marker icon travels along it tied to scroll progress (our version of the reference's rocket); each step card glows active as the marker passes.
- **Tabbed showcase:** icon tabs with animated underline (layoutId); switching crossfades the laptop-mockup screenshot; auto-advance every 6 s, pause on hover.
- **Industry carousel:** drag/scroll-snap cards + dot indicators + round arrow buttons, exactly the reference pattern.
- **Micro:** "SCROLL TO EXPLORE" indicator (pulsing dot in a pill) at hero bottom; navbar turns glassy (backdrop-blur + border) after 40px scroll; stat numbers count up on first view.
- **prefers-reduced-motion:** globe static frame, reveals become simple fades, marker/timeline static, count-ups instant — full content parity.
- **Performance budget:** LCP element is the H1 (never the canvas); globe + framer chunks lazy-loaded; total JS < 250 kB gz on Home; 60fps scroll on a mid laptop — if a trick can't hit that, cut the trick, not the frame rate.

**Pages & sections:**
1. **Home (/)** — sticky nav (logo, Platform, For TSPs, Pricing, Docs, Contact; pill CTA "Request pilot"; round language switcher). **Hero:** section label "— TELTONIKA-FIRST TRACKING PLATFORM"; H1 "TRACKING THAT MATCHES / YOUR AMBITION" (second line gradient); subline one sentence (white-label, multi-tenant, EU-hosted); primary pill "Request a pilot" + ghost "See it live"; the cobe globe fills the lower half with EU markers + arcs; SCROLL TO EXPLORE indicator. **Verticals carousel** ("— BUILT FOR YOUR FLEET"): 6 industry cards (Fleet ops, Logistics, Construction, Agriculture, Rental, Cold chain) with gradient headers, one-line pain→outcome copy, "Discover →" pill (anchors to /tsp). **Platform showcase** ("— ONE PLATFORM, YOUR BRAND"): icon tabs [Live map · Trips & playback · Geofences & alerts · Reports · Commands] switching a laptop mockup with dashboard screenshots; beside it 3 stat tiles (translucent cards, count-up): devices per tenant, msg/s tested, uptime target — values are placeholders wired to measured numbers. **How it works** vertical journey timeline (4 steps: Point your Teltonika device → Shadow mode next to your current platform → Flip your clients to your brand → Scale per device) with the traveling vehicle marker. **API section:** dark code card (curl `GET /v1/devices`) + "REST & webhooks included" copy. **Trust band:** EU data residency, GDPR, OSM attribution note. **Final CTA** gradient band + footer (product links, legal, language switcher).
2. **For TSPs (/tsp)** — persona page: pains (per-device pricing that scales, migration from legacy platforms, your clients never see our brand), white-label explainer diagram (Platform → Your brand → Your clients), migration steps (point device via SMS/Codec12, shadow mode, switch), FAQ accordion (8 questions: data ownership, export, SLA, device support list, contract terms, GDPR, offline behavior, commissions/affiliate for referrers).
3. **Pricing (/pricing)** — three cards: Starter €49/mo (1 org, 200 devices' pool note), Growth €149/mo (5 orgs, 2,000), Scale €399/mo (unlimited orgs, 20,000) + per-device overage line + "Pilot program: free during shadow mode" banner + comparison table (rows: live map, trips, geofences, alerts, reports, API, webhooks, white-label domains, support). Disclaimer: prices excl. VAT.
4. **Contact / Request pilot (/pilot)** — the form (above) + what happens next (3 steps) + direct email.
5. **Legal stubs** — /terms /privacy /dpa /subprocessors **/impressum (required for the German market — company name, address, contact, register no.)** rendering markdown from `src/content/legal/*.md` (placeholder text marked TODO-LEGAL).
6. **404** with a lost-vehicle map joke, link home.

**Components to build cleanly (reused):** NavBar, Footer, SectionHeading, FeatureRow, StatTile, PricingCard, FAQAccordion, CodeCard, PilotForm, LangSwitcher, AnimatedRouteMap.
**Content voice:** confident, technical, zero buzzword salad ("revolutionary", "AI-powered" banned). Write real copy, not lorem ipsum — plausible claims only, keep numbers matching the stat tiles.
**Deliver:** clean file tree under `src/`, README with env vars (`VITE_API_URL`, `VITE_TILES_STYLE_URL`), all pages responsive down to 360px.
---
## END PROMPT

## Integration notes (for us, not Lovable)
- Export from Lovable → drop into `apps/site`; align eslint/prettier; wire CI (`turbo run build --filter=site`); deploy as static via Caddy (site.<domain>) — zero backend except the pilot-request endpoint (see IMPLEMENTATION_PLAN E09-4).
- The `?ref` cookie + form field is the affiliate attribution entry point — contract defined in PROJECT_PLAN §6.9.
- Replace stat-tile numbers with real ones after E07-3 load test (don't ship marketing claims we haven't measured).

## Mini-audit (screenshot-driven revision, 5 rounds)
- **R1 Fidelity:** every observed reference pattern mapped: starfield ✓ globe+scroll rotation (cobe) ✓ section-label dash pattern ✓ caps headline w/ blue line ✓ pill buttons ✓ gradient-header industry cards + carousel ✓ icon tabs w/ underline (warm accent) ✓ laptop mockups w/ real UI ✓ parallax hardware floats ✓ journey timeline w/ traveling marker (rocket→vehicle) ✓ scroll indicator ✓.
- **R2 IP hygiene:** patterns adopted, assets NOT — no Akensys logo/illustrations/copy, no Teltonika product photos or logos; all illustrations original SVG; "Teltonika-first" used as factual compatibility claim only.
- **R3 Performance & a11y:** LCP guarded (H1, lazy canvas), JS budget 250 kB, reduced-motion parity mandated; Lighthouse targets adjusted Performance ≥85 (WebGL tax), A11y/SEO ≥95 unchanged.
- **R4 Stack compatibility:** only two new deps (framer-motion, cobe — both MIT, free-stack compliant); still Vite+shadcn, still monorepo-ready, no scroll-jacking (native scroll preserved).
- **R5 Cross-file consistency:** canonical tokens in DASHBOARD_UI_SPEC §1 updated to the blue/violet pair (#4DA3FF/#7C5CFC) so app and site share one palette; white-label mapping unaffected (tenant branding still overrides --accent); dashboard keeps its restrained Stripe/Cloudflare density — the space theatrics live on the marketing site only.
