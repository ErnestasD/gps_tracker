# ADR-038: Google basemap option via the Map Tiles API, rendered in Mapbox GL

Date: 2026-08-24 · Status: accepted (founder decision)

## Context

ADR-030 fixed the geo stack on Mapbox GL and rule 13 forbids introducing Google or any
other paid geo API without an ADR. The founder has now asked for exactly that, as a
customer-facing choice: settings must let the operator switch the map between Mapbox and
Google and back, with **all functionality intact**, plus an independent light/dark basemap
colour preference for both providers.

## Decision

**The renderer never changes.** Mapbox GL remains the single map engine on every surface
(live map, playback, geofences, routing). "Google" is a **basemap swap only**: official
**Google Map Tiles API** 2D raster tiles (`tile.googleapis.com/v1/2dtiles`) served through a
session token and mounted as a GL `raster` source in a minimal style. Every runtime source
and layer — clusters, trails, halos, the scrub ghost, geofence polygons, labels — rides on
top unchanged, so feature parity holds by construction rather than by re-porting four map
surfaces to a second SDK.

- Provider and colour scheme are **device-local display prefs** (`mapProvider`,
  `mapScheme: auto|light|dark`; `auto` follows the app theme) applied live through the
  existing `style.load` re-setup path that theme swaps already exercise.
- Dark Google tiles use the documented night-mode `styles` array passed to
  `createSession`; sessions (valid ~2 weeks) are cached in localStorage per scheme.
- Key: `VITE_GOOGLE_MAPS_KEY` in the untracked `apps/web/.env`, HTTP-referrer-restricted
  in the Google Cloud console (same posture as the Mapbox `pk.` token). With no key the
  Google option is not offered in settings.
- Failure posture: an unreachable Tiles API falls back to the same-scheme Mapbox style —
  the preference is kept, the operator is never stranded on a black map.
- Symbol-layer glyphs stay on the Mapbox fonts endpoint (already tokened) so device name
  labels render identically on both basemaps.
- Attribution: `© Google` rides on the raster source and Mapbox attribution/logo remain
  on Mapbox styles (ADR-030 TOS posture unchanged).

## Consequences

- Google Map Tiles API is billable per session/tile — usage must be monitored in the
  Google Cloud console the same way Mapbox loads are (ADR-030).
- Geocoding (Photon) and routing (OSRM) are unaffected — this ADR covers basemap tiles
  only; rule 13 still bars any further Google surface without a new ADR.
- The offline dev/e2e style override (`VITE_MAPBOX_STYLE_*`) keeps working: tests run on
  the Mapbox provider default and never touch the network.
