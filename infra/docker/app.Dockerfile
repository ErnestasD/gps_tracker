# Orbetra app image (staging deploy, W7-D). ONE image for all four apps — the monorepo
# runs via tsx (same as dev/e2e), each compose service overrides the command. The web SPA
# is pre-built (vite build) and served with `vite preview` behind Caddy, mirroring the
# e2e harness exactly (API_PROXY_TARGET carries /v1 — incl. the /v1/stream WS upgrade —
# to the api service).
FROM node:22-alpine

# pinned versions — unpinned tsx made builds unreproducible (review LOW). Runs as root
# for now (named volumes are root-owned; USER node needs a volume-permissions pass —
# staging-accepted tradeoff, hardening follow-up).
RUN npm i -g pnpm@10.34.4 tsx@4.23.0
WORKDIR /app

# manifests first — layer-cache pnpm install across source-only changes
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/ingest/package.json apps/ingest/
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
COPY packages/codec/package.json packages/codec/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
# every workspace package.json must be listed here — `pnpm install` silently installs only the
# projects it can SEE, so a missing line produces a green image whose api and worker both die on
# their first import with ERR_MODULE_NOT_FOUND. There is no build error to catch it.
COPY packages/registry/package.json packages/registry/
COPY tools/simulator/package.json tools/simulator/
COPY tools/replay/package.json tools/replay/
COPY tools/redact/package.json tools/redact/
COPY tools/seed-demo/package.json tools/seed-demo/
COPY tests/isolation/package.json tests/isolation/
RUN pnpm install --frozen-lockfile

COPY . .
# prisma client is gitignored generated code — build it in the image
RUN pnpm --filter @orbetra/db db:generate
# SPA builds: same-origin API (Caddy carves /v1 + /ws).
# apps/web (ADR-030): Mapbox GL — VITE_MAPBOX_TOKEN comes from apps/web/.env, which is
# UNTRACKED in git (GitHub push protection blocks Mapbox tokens) and reaches the build
# host via rsync (see README env table); vite reads it at build time. Styles default to
# mapbox dark-v11/light-v11 (override via VITE_MAPBOX_STYLE_DARK/_LIGHT if ever needed).
# apps/site stays on MapLibre, and its style URL is pinned EXPLICITLY so a design re-sync can't
# silently swap the tile provider. Deliberately changed to Carto dark-matter (Lovable v2): the site
# is a dark "mission-control" design and OpenFreeMap ships no dark style — liberty is light, so the
# old pin rendered a white basemap inside a near-black page. Attribution stays visible on every map
# (provider TOS). NOTE: tiles are third-party — the site must never claim self-hosted map tiles; the
# honest claim is self-hosted geocoding (Photon) + routing (OSRM).
ENV VITE_TILES_STYLE_URL=https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json
RUN pnpm --filter @orbetra/web build && pnpm --filter @orbetra/site build

# default command is a no-op; docker-compose.apps.yml sets one per service
CMD ["node", "--version"]
