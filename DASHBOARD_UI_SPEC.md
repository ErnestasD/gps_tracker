# DASHBOARD_UI_SPEC.md — App UI Specification (canonical design source)
**Audience:** Claude Code building `apps/web`. **Benchmark feel:** Stripe Dashboard density + Cloudflare clarity. **Stack (locked):** React 18 + Vite, Tailwind, **shadcn/ui as the only component kit** (no Tremor/MUI/Ant — ADR-gated), lucide-react icons, Recharts, TanStack Table/Query/Router, MapLibre GL, i18next, @fontsource/inter. Dark-first with full light mode.

## 1. Design tokens (canonical — public site copies these)
CSS variables in `apps/web/src/styles/tokens.css`, mapped to Tailwind theme:
`--bg #0B1020 · --surface #111A2E · --surface-2 #16213A · --border #22304C · --text #E7ECF4 · --muted #93A1B7 · --accent #4DA3FF · --accent-2 #7C5CFC · --success #34D399 · --warn #FBBF24 · --danger #F87171 · radius 10px · shadow-card 0 1px 2px rgb(0 0 0/.4) · font Inter · text-sm 13px default (dashboard density), text-base 15px for forms`.
**White-label mapping (E03-5):** `branding.primary → --accent`, `branding.accent → --accent-2`, logo swaps in sidebar+emails; contrast-checked fallback (if WCAG AA fails against surface, auto-lighten 15%). Light mode: `--bg #F7F9FC · --surface #FFFFFF · --text #0B1020 · --border #E3E8F0`.

## 2. App shell
- **Left sidebar** 240px, collapsible to 64px (icons+tooltips), sections: *Live* (Map), *Fleet* (Devices, Trips, History), *Automation* (Geofences, Rules, Events), *Insights* (Reports), *Ops* (Commands), *Admin* (Users, Branding, API keys, Webhooks, Billing/Usage; platform_admin extra: Tenants, Quarantine, Affiliates, Health). Active item: accent left bar + surface-2 bg.
- **Topbar** 56px: tenant/account switcher (combobox, shows role badge), global search **⌘K command palette** (devices by name/IMEI/plate, pages, actions "send command…"), notifications bell (unseen events count), user menu (locale, theme, logout).
- Content: max-w 1400px, px-6, page header pattern = H1 + subline + right-aligned primary action; breadcrumbs only ≥3 levels.
- Responsive: <1024px sidebar → drawer; map page gets bottom-sheet pattern on mobile (PWA).

## 3. Shared patterns (build once in `components/ui-x/`)
- **DataTable** (TanStack + shadcn Table): sticky header, column sort, filter row, density toggle, row hover reveal-actions, pagination cursor-based, empty state (icon+one-liner+primary action), skeleton rows on load, error state with retry. CSV export button top-right where API allows.
- **StatusDot**: online (success, pulse ≤60 s freshness) / stale (warn) / offline (muted) / never-seen (border only). Same semantics everywhere.
- **EntityDrawer**: right-side 480px drawer for quick views (device, event) — avoids page hops, Stripe-style.
- **ConfirmDialog** destructive = danger button + typed confirmation for `deleterecords`, delete device, revoke key.
- **Toasts**: bottom-right, 4 s, action link when applicable ("View event").
- Loading: skeletons everywhere, never spinners on full pages; route-level suspense.
- Time display: account TZ, tooltip shows UTC + ISO; relative ("2 min ago") only in Live contexts.

## 4. Page specs (V1 screens; story mapping in brackets)
- **Live Map [E02-6/E02-7]:** full-bleed map minus shell; left floating panel (320px, collapsible) = device list with search/filter (group, status), each row: StatusDot, name, speed, address-on-hover (geocode cache); click → follow mode + info card (bottom-left, Cloudflare-style card: speed, ignition, sats, voltage, quick actions: history, commands). Cluster bubbles use accent; selected device = accent-2 halo. Trail toggle (last 1 h). Invalid-fix gap = dashed. Vehicle markers rotate to `course` (arrow glyph); stale devices grey out the arrow. Address search box (forward geocode, Photon) recenters map. Map controls top-right (zoom, layers: light/dark style URL swap, traffic OFF—not in v1).
- **Devices [E03-3/4]:** DataTable (name, IMEI, profile, group, status, last seen, FW from last getver, actions); bulk bar on select (assign group, retire); Import wizard (upload → dry-run diff table with per-row badges → confirm); Quarantine tab (platform_admin): claim dialog (tenant→account→profile). Device detail page: header (status, quick stats), tabs: Overview (mini-map last pos, voltage/GSM sparklines — the "device health" nice), Trips, History, Commands, Settings (profile, odometer source, retention notice).
- **History [E04-3]:** date-range picker (presets: today, yesterday, 7d), track on map + synced Recharts panel below (speed line; fuel & ext-voltage series toggle when attrs exist); timeline scrubber sync map↔chart; stops as flags; export GPX/CSV (nice).
- **Trips [E04-4]:** DataTable grouped by day (start→end addresses, distance w/ source label, duration, idle, max speed); row click → drawer with route thumbnail + stats; ±5% disclaimer tooltip on distance source.
- **Geofences [E05-1]:** split view — list left (name, type, color chip, rules count), map right with terra-draw; create flow: draw → form (name, color, accounts scope) → save; area guard error inline.
- **Rules [E05-3]:** DataTable (kind icon, name, scope devices/groups, channels chips, cooldown, enabled switch); create wizard 3 steps (trigger → scope → channels/test-fire button sends sample notification).
- **Events [E05-4]:** filter bar (kind multi, device, range), stream-style list (icon, title, device, time, ack check), panic/power_cut rows tinted danger; click → drawer (map snip via static coords, payload JSON viewer); bulk acknowledge.
- **Reports [E06-1/2]:** left = report type cards (6), form (devices/groups, range, options), Run → inline result DataTable + "Export CSV/XLSX" (job status chip until URL ready); history of last 10 runs.
- **Commands [E08-2]:** device picker → preset grid (10 presets as cards w/ short desc) + raw input (mono, danger styling for destructive); queue table (status: queued/sent/acked/failed/expired, response mono-block expandable); RBAC-hidden for viewer.
- **Admin/Users, API keys, Webhooks [E03-2/E06-3/4]:** standard DataTables + create dialogs; API key shown ONCE pattern (copy field + warning); webhook row → deliveries sub-table (attempt, code, latency, body preview).
- **Branding [E03-5]:** live preview panel (sidebar+email mock update as you type), domain section with DNS TXT instructions + verify button + cert status.
- **Usage/Billing [E07-4]:** month picker, per-account device-days table, sparkline, CSV export; (Stripe portal link slot — nice).
- **Platform: Tenants/Health/Affiliates [E07-4/E09-3]:** tenants table (usage, status), health = read-only Grafana iframe cards (ingest rate, lag, depth), Affiliates per §PROJECT_PLAN 6.9 (list, rate override, monthly statement download, entries ledger with status chips pending/approved/paid/clawed_back).
- **Help/Support:** sidebar footer link (mailto support@, docs link) — no in-app chat v1.
- **Auth screens [E03-1]:** centered card on token-gradient bg, logo (tenant branding by Host), login + forgot-password stub (manual reset note v1).
- **Settings/Profile:** locale, theme, password change (attach to E03-2 CRUD scope — added AC there).

## 5. Charts (Recharts) rules
Line charts: 1.5px stroke, accent for primary series, muted grid (border color), no gradients fills except hero-map contexts; tooltips follow tokens; time axis ticks in account TZ; empty→"No data for range" state; downsample >5k points (LTTB) client-side.

## 6. Accessibility & i18n
WCAG AA contrast (tokens pre-checked); full keyboard nav (palette, tables, dialogs — shadcn covers, verify focus rings visible on dark); all icons with aria-labels; no color-only status (dot + label). Strings via i18next only (lint rule from E08-3); dates/numbers via Intl.

## 7. Quality gates for UI stories
Playwright smoke covers each page's happy path; Storybook NOT used (avoid maintenance—components proven via pages); visual sanity = screenshot artifacts in CI for Map, Devices, History (compared manually in PR); Lighthouse app-shell perf ≥85 (map page exempt), PWA installable check stays (E02-6).

## 8. Explicit non-goals v1
No theme builder beyond branding tokens; no drag-drop dashboard widgets; no per-user layout persistence; no realtime charts (<60 s refresh polling on Usage only); no map traffic/satellite layers.

## 9. Combined audit log (this file + PUBLIC_WEB_LOVABLE.md, 5 rounds)
- **R1 Stack & token compatibility:** one token source (this §1), public prompt copies values verbatim; both on identical stack; white-label var mapping matches E03-5 implementation notes. Divergence risk closed by "spec wins" line in the Lovable file.
- **R2 Story coverage of every screen:** each §4 page carries a story ID; two gaps found & FIXED by patching IMPLEMENTATION_PLAN — (a) Reports UI had no home → added to E06-2 AC; (b) Settings/Profile screen unowned → added to E03-2 scope. Device-health sparklines correctly labeled V1-nice (matches PROJECT_PLAN).
- **R3 Consistency with hard rules:** OSM attribution present (map pages + site footer); no paid geo APIs anywhere; no new component libs (shadcn-only holds for both surfaces); time-display rule matches CLAUDE.md rule 7 (UTC storage, account-TZ render).
- **R4 UX-debt honesty:** patterns chosen for 2-dev maintainability (no Storybook, drawer-over-modal, skeletons standard); every "nice" flourish either free (CSS) or cut (§8). Command palette justified: it replaces 3 nav features for cost of one shadcn combobox.
- **R6 Token sync (screenshot revision):** accent pair updated to #4DA3FF/#7C5CFC to match the approved space-blue public-site direction; contrast re-checked on --surface (AA pass for text-on-accent with ink text). Dashboard density/patterns unchanged — marketing motion stays on the site.
- **R5 Vision check:** does this read as "between gps-server and GpsGate, modern like Stripe/Cloudflare"? Density + palette + drawer patterns say yes; the tell will be Map page performance — gate kept (500 devices smooth, E02-6). Affiliate screens present so the business model (friend + 20% partners) is operable from the platform panel, not spreadsheets.
