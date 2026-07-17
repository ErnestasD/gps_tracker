# Orbetra app image (staging deploy, W7-D). ONE image for all four apps — the monorepo
# runs via tsx (same as dev/e2e), each compose service overrides the command. The web SPA
# is pre-built (vite build) and served with `vite preview` behind Caddy, mirroring the
# e2e harness exactly (API_PROXY_TARGET carries /v1 + /ws to the api service).
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
# apps/web (ADR-030): Mapbox GL — VITE_MAPBOX_TOKEN comes from the committed
# apps/web/.env (public pk. token) which vite reads at build time; styles default to
# mapbox dark-v11/light-v11 (override via VITE_MAPBOX_STYLE_DARK/_LIGHT if ever needed).
# apps/site stays on MapLibre + OpenFreeMap — pin its style URL explicitly so a design
# re-sync can't silently reintroduce a CDN.
ENV VITE_TILES_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
RUN pnpm --filter @orbetra/web build && pnpm --filter @orbetra/site build

# default command is a no-op; docker-compose.apps.yml sets one per service
CMD ["node", "--version"]
