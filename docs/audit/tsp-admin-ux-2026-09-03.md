# TSP admin UX audit — 2026-09-03

Ordered by the founder after the first real TSP self-checkout: *"TSP adminas mato tokį patį
dashboardą kaip ir direct useris"* — and he is right. Every page below was audited against the
target model he set, with one amendment he accepted the reasoning for.

## The target model

- A tenant-wide TSP admin (**overseer**) sees ALL data under the tenant, filterable by customer
  account, from a read-only overview.
- To CREATE or EDIT operational objects, the overseer explicitly enters ONE account's context —
  "acting for customer X" — where they get exactly the customer's own capabilities.
  *(Amendment to the founder's original "TSP admin never edits": a reseller configuring zones and
  rules FOR a small customer is a core service motion — Wialon/GpsGate resellers live in it. The
  read-only rule therefore applies to the MERGED view, not to the admin.)*
- Dashboard and reports for the overseer are reseller-centric: customers, devices per account,
  allowance usage — not one fleet's KPIs.
- Account-scoped customer users are unaffected; their token pins them server-side.

## The mechanism

`apps/web/src/lib/accountContext.ts` — a client-side context ('' = all accounts / one accountId),
localStorage-backed, switcher in the shell topbar. Deliberately NOT a server security boundary:
the server already authorises a tenant-wide admin for everything; the context is the difference
between acting deliberately and acting by accident. Server-side scoping stays on customer tokens.

## Matrix (state before the fix)

| page | accountId in data | account filter | overseer's create lands | verdict |
|---|---|---|---|---|
| `/app` landing | — | — | — | map for everyone → overseer needs the customer overview |
| map | WS payload carries it | status filter only | — | filter by context |
| dashboard | yes | none | — | reseller variant for overseer |
| devices | required in create, picker | column | picked account ✓ | pre-scope from context |
| drivers | picker in create | column if >1 | picked ✓ | pre-scope + merged-view read-only |
| **geofences** | **nullable → omitted** | none | **`accountId: null` = tenant-shared → visible to EVERY customer** | **data leak — the worst finding** |
| rules | required, picker | row suffix | picked ✓ | pre-scope + merged-view read-only |
| events | in payload | **none** | — | account column + context filter |
| trips | partial | partial | — | context filter |
| maintenance | partial | ? | plan applies per account | context filter + read-only merged |
| reports | API is single-account; tenant-wide caller MUST name one | picker | — | keep per-customer; add reseller report (allowance/growth) |
| scheduledReports | prop-driven | — | — | follows reports |
| apiKeys | nullable, picker incl. tenant-wide | — | tenant or account | OK — a tenant key is a legitimate reseller key |
| webhooks | hardcoded `accountId: null` | — | tenant-wide | OK — reseller integration endpoint; document |
| accounts (new, #258) | — | — | — | becomes the overseer's hub, surfaced on the dashboard |
| audit / branding / billing / settings | tenant-level | — | — | OK — genuinely tenant-level |

## Backend facts the fix leans on

- No list endpoint accepts an `accountId` query filter → filtering is client-side; payloads carry
  `accountId` (verified: WS fanout `apps/api/src/ws.ts:252`, list views).
- `usage_daily` is per device+account+day (`schema.prisma:1083`) — per-customer usage exists;
  nothing exposes plan allowances (they live in worker-side `STRIPE_INCLUDED`). Product-truth
  allowances (300/1,000/3,500 — PRICING_STRATEGY §3) are added to `@orbetra/shared` for the UI.
- Reports API (`apps/api/src/routes/reports.ts:64`) requires ONE account for a tenant-wide caller —
  already compatible with "reports are per customer, chosen from the overview".

## Delivery (landed as one PR, #262)

- **The spine** — account context + topbar switcher; geofence create carries the context's
  accountId (leak closed); merged view withholds operational writes (geofences, rules, drivers)
  with a notice naming the rule; devices/drivers/rules create pre-scoped from context;
  map (inside liveStore), events (device→account join), trips, devices get the context filter.
- **The overseer home** — the reseller dashboard at /app/dashboard: customers table (devices,
  MTD activity, device-days, logins, "Open" → act-for + map), allowance meter vs plan
  (`TSP_INCLUDED_DEVICES`, PRICING_STRATEGY §3), `GET /v1/usage/accounts` (tenant-wide-gated).
  The LANDING decision lives in login (overseer → dashboard, everyone else → the map at /app):
  /app/map already redirects to /app, so a landing redirect at /app would have made the live map
  unreachable for the overseer — caught by the full e2e suite before push.
