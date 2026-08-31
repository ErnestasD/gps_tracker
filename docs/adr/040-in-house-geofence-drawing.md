# ADR-040: in-house geofence drawing, replacing terra-draw

**Date:** 2026-08-31 · **Status:** accepted · **Supersedes:** ADR-021

## Context

ADR-021 adopted **terra-draw** for the geofence editor and was never revisited when the code
moved on. `ee8ff3c` (2026-08-24) removed the dependency entirely and replaced it with a
drawing engine written in this repo — but shipped **no ADR**, so the normative documents went
on naming a library that is no longer installed.

That is the discrepancy this record closes. A reader of PROJECT_PLAN §5, README, ADR-021 or
the e2e comments would have concluded terra-draw is the current editor; `pnpm-lock.yaml` has
not contained it since that commit.

## Decision

**The geofence editor is in-house**, in `apps/web/src/routes/app/geofences.tsx`: one set of
Mapbox GL handlers driving all three shapes.

- **polygon** — click each corner; close by clicking the first vertex (marked, ADR-040 note
  below) or double-clicking
- **circle** — click the centre, move to size, click again; radius shown live
- **corridor** — click the route, double-click to finish; the buffer half-width is a form field
- Esc restarts the sketch; the trailing duplicate vertices a finishing double-click produces
  are trimmed in **screen space**, so `CLOSE_PX` means "the same spot" at any zoom
- the closing vertex is drawn inverted and grows once the ring can actually be closed (#240)

**Why in-house rather than the Mapbox adapter for terra-draw:** ADR-030 moved the renderer
from MapLibre to Mapbox GL, which made terra-draw's value a MapLibre-native adapter we no
longer used. What remained was a dependency carrying three modes we had to restyle anyway,
against three shapes whose entire interaction is roughly two hundred lines. Rule 10 asks for
a paper trail to ADD a runtime dependency; removing one needs the same trail, and this is it.

## Consequences

- **One less runtime dependency** on an admin-only screen (ADR-018's bundle argument, reversed).
- **No adapter to track** across renderer changes. ADR-030 listed "swap the MapLibre adapter for
  the Mapbox adapter" as migration work; that item is now moot.
- **We own the interaction**, including the affordances a generic library would not give us —
  the marked closing vertex is the first example.
- **Circles are still stored as their polygon**, unchanged from ADR-021: `geography(Polygon,4326)`
  with the area guard. The DB is untouched by this decision.
- **Corridor centre-lines are still not persisted** — `geofences.geom` holds only the buffered
  polygon, so a corridor cannot be re-opened for vertex editing without a schema change. Stated
  here because it is a real limit of the current model, not of the drawing tool.

## Alternatives rejected

- **terra-draw + Mapbox adapter.** Keeps a dependency for interaction we had already partly
  replaced (the circle engine predates this commit), and its styling still had to be overridden.
- **Leave ADR-021 standing and say nothing.** The state the repo was actually in this morning:
  every normative document pointing at a library that is not installed.
