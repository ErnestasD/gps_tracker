# ADR-030: Mapbox GL JS replaces MapLibre + OpenFreeMap

Status: accepted (founder decision, 2026-07-17)

## Context

Rule 13 mandated a free geo stack (MapLibre + OpenFreeMap tiles). After the admin redesign the
founder decided the map look must match the product's ambition and chose **Mapbox** (visually
richer styles, better label density/localization), providing a `pk.` public token.

## Decision

1. **Library**: `mapbox-gl` (v3) replaces `maplibre-gl` in apps/web. The APIs are siblings
   (MapLibre forked mapbox-gl v1) — sources/layers/handlers port ~1:1. Mapbox styles REQUIRE
   mapbox-gl per their TOS (loading them through MapLibre is not permitted).
2. **terra-draw**: swap the MapLibre adapter for the Mapbox adapter (geofence editor).
3. **Token**: `pk.` tokens are public by design (they ship in the client bundle), so this is
   config, not a secret (rule 12 unaffected) — env-injected (`VITE_MAPBOX_TOKEN`) via an UNTRACKED `apps/web/.env` (GitHub push
   protection flags Mapbox tokens as secrets, so it stays out of git; rsync carries it to
   staging; e2e uses a dummy — the offline dev-style never hits Mapbox), never hardcoded, and **URL-restricted in the Mapbox dashboard** (orbetra.com, dash.orbetra.com,
   localhost) so third parties cannot burn the quota.
4. **Style — theme-reactive (founder: "premium in both themes")**: dark theme →
   `mapbox://styles/mapbox/dark-v11`, light → `light-v11` (env overrides
   `VITE_MAPBOX_STYLE_DARK`/`_LIGHT`). Maps subscribe to `onThemeChange` and `setStyle`
   live; every surface registers its sources/layers/images in an idempotent `style.load`
   handler so custom layers (clusters, arrows, trails, geofences, routes) survive the swap.
5. **Attribution**: Mapbox attribution + logo stay visible (TOS requirement) — replaces the OSM
   attribution note in rule 13.
6. **Scope**: all 5 map surfaces — LiveMap, PlaybackMap, geofences editor, public share page,
   routing planner. The e2e contract (`__map` handle, layer ids `trail-gap`, `device-arrows`,
   clustering) is preserved.
7. **Self-hosted Photon (geocoding) and OSRM (routing, ADR-029) stay** — Mapbox is tiles/render
   only; no Mapbox Directions/Geocoding APIs (cost control).

## Consequences

- `mapbox-gl` v2+ is proprietary-licensed (free to use with a Mapbox account); rule 10 dep
  covered by this ADR. Free tier 50 000 map loads/month — usage monitored in the Mapbox
  dashboard; the git history keeps the MapLibre implementation as the rollback path.
- `TILES_STYLE_URL` env is retired; README env table updated.
- CLAUDE.md rule 13 amended in the same PR.
