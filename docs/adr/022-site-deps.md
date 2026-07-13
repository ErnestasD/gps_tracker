# ADR-022: apps/site runtime dependencies (public marketing site)

**Date:** 2026-07-13 · **Status:** accepted · **Story:** W9-S1 (CLAUDE.md rule 10 gate)

## Context

PUBLIC_WEB_LOVABLE.md sanctions the marketing site's stack: Vite + React + Tailwind +
shadcn, plus AT MOST framer-motion and cobe, MapLibre allowed as the map alternative.
The founder generated the design in Lovable (orbetra_design/); it arrived using
framer-motion + maplibre-gl (instead of cobe — the allowed alternative), plus two
visual extras the founder picked in the design tool: recharts (dashboard-mock charts
inside the device mockups) and @number-flow/react (animated stat counters).

## Decision

apps/site runtime deps (all MIT, no paid APIs — rule 13 intact):
- react/react-dom 18, @tanstack/react-router (+react-query) — same stack as apps/web
- framer-motion (spec-sanctioned), maplibre-gl (spec-sanctioned map path)
- recharts, @number-flow/react — founder-originated design choices from Lovable;
  visual-only, no data/network access. Accepted rather than re-implementing the
  founder's approved visuals.
- @fontsource/{inter,space-grotesk,jetbrains-mono} — self-hosted fonts (spec: no
  Google Fonts CDN)
- clsx + tailwind-merge (cn helper, same as apps/web)

The Lovable-only toolchain was NOT imported: TanStack Start, nitro,
@lovable.dev/vite-tanstack-config, bun. apps/site builds as a plain static Vite SPA
served by Caddy — no server runtime.

## Consequences

- orbetra_design/ remains the Lovable source; syncs into apps/site are manual with
  review (drift risk documented in the W9-S1 plan).
- Design components live under a relaxed lint/tsconfig island (unsafe-any family off,
  noUncheckedIndexedAccess off) — OUR code in apps/site (lib/, form wiring, routes
  edits) stays fully checked.
