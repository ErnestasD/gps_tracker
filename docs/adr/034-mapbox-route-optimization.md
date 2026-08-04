# ADR-034 — Route optimization moves to the Mapbox Optimization API

**Status:** accepted (founder decision, 2026-08-04)
**Supersedes the routing half of** ADR-029 (self-hosted OSRM). ADR-030 (Mapbox GL JS for map
tiles) and the self-hosted Photon geocoder are unaffected.

## Context

`POST /v1/routing/optimize` — the "Route planner" screen — takes 2–50 stops and returns the optimal
visiting order over real roads. It was served by a self-hosted OSRM container with a Lithuania-only
Geofabrik extract, and the screen said so: *"pilot coverage: Lithuania"*.

Growing that coverage was costed properly before deciding. For LT + PL + LV + EE + DE (6.86 GB of
PBF, measured against Geofabrik on 2026-08-04):

- **Disk:** ~12 GB of prepared data, against 47 GB free on the staging box. Fine.
- **Serving RAM:** the dataset is memory-mapped, competing for page cache with Postgres/TimescaleDB,
  Redis, Photon, Prometheus and four app containers on a 16 GB box. Tight.
- **Build RAM:** `osrm-extract` needs roughly 8–10× the PBF — **30–40 GB**. The box has 16. Building
  in place is impossible; it needs a temporary machine, **every quarter**, as OSM data goes stale.
- The vpsnet upgrade path (KVM-3 → KVM-6, 64 GB) is **irreversible** — "resources can only be
  increased" — so "upgrade temporarily, then downgrade" is not available.

Against that: the Mapbox Optimization API needs no dataset, no disk, no RAM and no rebuild, covers
the planet on day one (including the cross-border routes an international haulier needs), and is
**free to 100,000 requests/month** where this feature would use a few thousand.

Its one hard constraint is **12 coordinates per request**.

## Decision

Use Mapbox. Cap the API at 12 stops.

The 50-stop capability was protecting a number **no customer had asked for**, in a side feature of a
GPS *tracking* product — one that takes raw `lat,lon` pairs rather than addresses, and that no real
courier can feed from their delivery list. Paying for it in permanent server cost, a quarterly
manual rebuild and page-cache pressure on the database that serves the map and every report was the
wrong trade.

Both engines sit behind one seam (`pickEngine` in `apps/api/src/routes/routing.ts`). Mapbox
Optimization v1 *is* OSRM's trip service — same parameters, same response shape — so they share
`mapOsrmTrip` and cannot disagree about what a route means. If a customer ever needs more than 12
stops, OSRM returns by setting `OSRM_URL` and preparing a dataset; nothing else changes.

## Consequences

- **`MAPBOX_TOKEN`** is required server-side for the feature to work; absent (and with no
  `OSRM_URL`) the route 503s, as it did before. It is a secret: server `.env` only, never git —
  GitHub push protection blocks Mapbox tokens.
- The token travels as a **query parameter** (the only form the API accepts), so the request URL
  must never be logged or echoed in an error body (rule 12).
- The **marketing site's "self-hosted routing" claim is removed.** It stops being true today, and
  the honesty rules in `apps/site` say we never claim what we do not run.
- The OSRM compose service stays defined behind its `osrm` profile, unused, as the documented
  alternative driver.
- Cost is $0 at present volume and would reach roughly $200/month at 200k optimizations — a
  problem worth having, and the point at which OSRM is worth revisiting.
