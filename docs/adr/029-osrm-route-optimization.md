# ADR-029: OSRM route optimization (multi-stop planner)

Date: 2026-07-17 · Status: accepted · Founder approval: blanket "viskas iki galo" mandate (2026-07-17)

## Context

Fleet operators plan multi-stop delivery/service runs and want a "best order to visit
these stops" answer plus the road path to drive. We need routing on real roads without
violating the free-stack mandate (CLAUDE.md rule 13 — no Google/Mapbox/paid geo APIs).

## Decision

- **Engine:** self-hosted **OSRM** (`ghcr.io/project-osrm/osrm-backend`, BSD-2-Clause —
  rule 13 compliant, same self-host posture as Photon). Pinned image tag `v5.27.1`.
- **Dataset:** Lithuania Geofabrik extract only for the pilot (`lithuania-latest.osm.pbf`).
  A PL (or wider) rollout merges extracts with `osmium merge` before `osrm-extract`; the
  merge path is documented in `infra/osrm/README.md`. Quarterly data refresh.
- **Algorithm:** MLD (`osrm-extract -p /opt/car.lua` → `osrm-partition` → `osrm-customize`,
  served with `osrm-routed --algorithm mld`). MLD customization is cheap enough for the
  refresh cadence and fits KVM-3.
- **API surface:** ONE stateless endpoint, `POST /v1/routing/optimize`, backed by OSRM's
  `/trip/v1/driving/…` service (TSP approximation: exact for small n, farthest-insertion
  heuristic beyond — http://project-osrm.org/docs/v5.24.0/api/#trip-service). We cap the
  request at **50 stops**, comfortably below the container's `--max-trip-size 100`.
  Time windows / vehicle capacities are OUT of scope — **VROOM in front of OSRM is the
  documented V2 path** if tenants need them.
- **No new npm dependency** (rule 10): the API calls OSRM with native `fetch`. The "new
  dependency" of this feature is the infra container only — this ADR covers it (rule 10's
  spirit) the same way ADR-016/018 covered app deps.
- **No persistence in V1:** the result is returned to the caller and never stored — no
  Prisma model, no migration, no new tenant-scoped data surface (nothing for the isolation
  manifest; the route is EXEMPT with the other non-entity routes and touches no tenant data).
- **Config:** env-gated `OSRM_URL` on the API. Absent ⇒ the endpoint answers 503 and the
  web page degrades to a friendly "not configured" message. Rate limit 30 req/min/user
  (Redis fixed window, same script as the share/caddy-ask limiters).

## Capacity (staging KVM-3, 15 GB RAM)

- Serving LT routed data: ~1–2 GB RSS; disk ~2–3 GB in the `orbetra_osrm_data` volume.
- Preprocessing peaks at ~4–6 GB — run it off-peak on the box or prepare the volume on
  another machine and copy it in (runbook covers both).

## Consequences

- Local `make up` does NOT start OSRM (compose `profiles: [osrm]`) — devs lack the
  prepared extract; the API degrades to 503 and the UI says so. Real-route verification
  is staging-only (see `infra/osrm/README.md` + deploy runbook).
- Larger coverage (PL/DE) means a bigger extract, more RAM and a longer prep — revisit
  sizing before enabling for non-LT tenants.
