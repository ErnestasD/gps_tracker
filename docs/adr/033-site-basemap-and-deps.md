# ADR-033 — Public-site basemap provider + the Lovable v2 dependency set

Status: accepted · 2026-08-03 · amends ADR-030 (scope: the public marketing site only)

## Context

ADR-030 mandates **Mapbox GL JS** for map surfaces in `apps/web` (the product). The public marketing
site `apps/site` was deliberately left on **MapLibre + OpenFreeMap** — no token, no paid provider,
decorative maps only.

The Lovable v2 redesign makes the site a near-black "mission-control" design where a light basemap
reads as a white slab in the middle of the page. OpenFreeMap ships no dark style (liberty / bright /
positron are all light), so keeping it means shipping a visibly broken hero.

Mapbox is not a drop-in here either: its styles require the Mapbox SDK/token, and serving Mapbox
tiles through MapLibre is against Mapbox's terms. Putting a Mapbox token on the public site would
also widen the token's exposure for a purely decorative map.

## Decision

1. **`apps/site` uses the CARTO `dark-matter` basemap style** (free CDN tier), pinned explicitly via
   `VITE_TILES_STYLE_URL` in `infra/docker/app.Dockerfile` so a future design re-sync cannot swap the
   provider silently. Attribution stays visible on every map (provider TOS).
   - `apps/web` (the product) is **unchanged**: Mapbox per ADR-030.
   - CARTO is added to the public **subprocessors list** — it receives visitor request metadata (IP,
     UA) on the marketing site. **No customer or telemetry data is sent** (the site's maps render
     invented sample coordinates only).
   - Honesty rule unchanged: the site must never claim self-hosted map *tiles*. The truthful claim is
     self-hosted **geocoding (Photon) + routing (OSRM)**.
2. **Site dependency set** (rule 10 requires an ADR for new runtime deps). The v2 design adds:
   `@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@radix-ui/react-tabs` (accessible primitives
   already used by `apps/web`'s vendored shadcn kit), `class-variance-authority`, `sonner` (toasts),
   `react-day-picker` + `date-fns` (the demo's date range), and `i18next` + `react-i18next` (the
   EN/PL/DE/LT switcher — `apps/web` already ships react-i18next, so this is the same stack).
   All are MIT, already transitively familiar to the repo, and confined to `apps/site`.

## Consequences

- One more subprocessor to disclose (done: `apps/site/src/routes/subprocessors.tsx`).
- If CARTO's free tier ever becomes unacceptable, the swap is a single env var; self-hosting a dark
  style from our own tileserver is the escape hatch (tracked as a follow-up, not scheduled).
- The site's bundle grows; it is a static SPA behind Caddy, so this is acceptable.
