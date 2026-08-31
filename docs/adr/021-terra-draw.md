# ADR-021: terra-draw for the geofence map editor

**Date:** 2026-07-09 · **Status:** SUPERSEDED by [ADR-040](040-in-house-geofence-drawing.md) (2026-08-31) · **Story:** E05-1 (CLAUDE.md rule 10 gate)

> Superseded, not wrong. terra-draw was the right call while the renderer was MapLibre; ADR-030
> moved us to Mapbox GL, which left the adapter — its main value — unused. `ee8ff3c` removed the
> dependency and replaced it with an in-house engine. The text below is kept as the record of the
> original decision; for what the editor is TODAY, read ADR-040.

## Context

E05-1 needs an interactive polygon/circle drawing editor on the MapLibre map so operators
can define geofences. PROJECT_PLAN §5 already names the choice: **terra-draw** (MIT,
MapLibre-native) — https://github.com/JamesLMilner/terra-draw. This is a new apps/web
runtime dependency, so it needs the rule-10 paper trail.

## Decision

- **Adopt `terra-draw` + its MapLibre adapter in apps/web.** It is the plan-sanctioned,
  MIT-licensed, MapLibre-GL-native drawing library (polygon, circle, select/edit modes),
  and it emits GeoJSON directly — matching the geofence API's `geometry` contract.
- Circles are drawn with terra-draw's circle mode and stored as their **polygon**
  approximation (the DB column is `geography(Polygon,4326)`); `kind='circle'` is retained
  as UI metadata only.
- No paid/Google/Mapbox geo dependency is introduced (CLAUDE.md rule 13 holds): terra-draw
  is a pure client drawing layer over our existing MapLibre + OpenFreeMap stack.

## Consequences

- Geofence geometry is validated server-side (`ST_IsValid`) and bounded (`ST_Area ≤
  10,000 km²`, §6.3) regardless of what the editor produces — the client library is a
  convenience, never the trust boundary.
- Bundle grows by the terra-draw client; acceptable for an admin-only editor screen.
- Downstream geofence stories (E05-2 transition detection) consume the same GeoJSON the
  editor stores; this ADR covers the dependency for the geofence feature set.
