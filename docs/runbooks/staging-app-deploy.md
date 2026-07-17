# Staging app deploy (W7-D, vpsnet KVM-3 @185.80.129.33)

Apps run as Docker services from ONE image (`orbetra-app`) layered over the infra
compose. Deploy = rsync repo → build on server → compose up → migrate → seed.
Compose project name is pinned by the base file (`name: orbetra`) — no -p needed.

## One-time server prep (done 2026-07-13)

- `/opt/orbetra/app` — repo copy (rsync; `.dockerignore` also guards the image context).
- `/opt/orbetra/.env` — secrets, NEVER in git (rule 12): `PG_PASSWORD`, `JWT_SECRET`
  (32+ chars), `ORBETRA_STAGING_HOST=185.80.129.33`, `PUBLIC_API_URL=http://185.80.129.33`,
  `DEMO_PASSWORD`, `COOKIE_SECURE=0`, `CADDY_HTTP_PORT/CADDY_HTTPS_PORT`.

## Deploy (repeat per release)

```sh
# from the repo root, local machine
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude orbetra_design \
  --exclude 'apps/web/dist' --exclude 'playwright-report' --exclude test-results \
  -e "ssh -i ~/.ssh/orbetra_staging" . root@185.80.129.33:/opt/orbetra/app/

ssh -i ~/.ssh/orbetra_staging root@185.80.129.33 '
  cd /opt/orbetra/app/infra/compose &&
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml build app-base &&
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml up -d
'
```

## Migrations + seed (idempotent)

The remote shell must SOURCE the env file — `--env-file` only feeds compose-file
interpolation, not `$VARS` your shell expands into `-e` flags (review HIGH: an unsourced
shell sent an EMPTY DEMO_PASSWORD and bricked the demo logins).

```sh
ssh -i ~/.ssh/orbetra_staging root@185.80.129.33 '
  set -a; . /opt/orbetra/.env; set +a
  cd /opt/orbetra/app/infra/compose
  # migrations: DATABASE_URL comes from the api service env (compose interpolation)
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml \
    run --rm api sh -c "cd packages/db && pnpm exec prisma migrate deploy && cd ../.. && tsx packages/db/sql/migrate.ts"
  # demo tenant (SEED_DEMO_ALLOW required: db/redis hosts are not loopback inside compose)
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml \
    run --rm -e SEED_DEMO_ALLOW=1 ${DEMO_PASSWORD:+-e DEMO_PASSWORD=$DEMO_PASSWORD} \
    -e REDIS_URL=redis://redis:6379 -e INGEST_HOST=ingest api \
    tsx tools/seed-demo/src/main.ts --yes
'
```

## Verify

- `curl http://185.80.129.33/healthz` → ok (Caddy)
- `curl http://185.80.129.33/v1/branding` → `{}` (default branding JSON)
- Login at `http://185.80.129.33` with `demo-admin@orbetra.test` + DEMO_PASSWORD.
- Prometheus (`ssh -L 9090:127.0.0.1:9090`) targets ingest/worker/api green
  (staging scrape config: `infra/prometheus/prometheus.staging.yml`).

## Notes

- HTTP-by-IP is TEMPORARY until DNS (`COOKIE_SECURE=0`). DNS day: set
  `ORBETRA_PUBLIC=true`, `COOKIE_SECURE=1`, AND add the domain to
  `apps/web/vite.config.ts` `preview.allowedHosts` (vite preview 403s unknown
  Hosts — IPs pass by default, domains do not).
- Ingest is the only app port published beside Caddy (5027 — devices). Internal
  services stay loopback/compose-network only (PR #11: Docker bypasses UFW).
- The `exports` volume is mounted on BOTH worker (writes) and api (download streams).
- Route optimization (ADR-029): PREP the osrm volume (`infra/osrm/README.md` — download
  the LT extract + osrm-extract/partition/customize, off-peak: prep peaks 4–6 GB RAM)
  BEFORE setting `OSRM_URL=http://osrm:5000` in `/opt/orbetra/.env` and enabling
  `COMPOSE_PROFILES=osrm`. Without the prepared volume the container crash-loops.
- No CD pipeline yet — this runbook IS the deploy. GitHub Actions CD = follow-up.
