# Staging app deploy (W7-D, vpsnet KVM-3 @185.80.129.33)

Apps run as Docker services from ONE image (`orbetra-app`) layered over the infra
compose. Deploy = rsync repo → build on server → compose up → migrate → seed.

## One-time server prep (already done 2026-07-13)

- `/opt/orbetra/app` — repo copy (rsync, excludes node_modules/orbetra_design).
- `/opt/orbetra/.env` — secrets, NEVER in git (rule 12): `PG_PASSWORD`, `JWT_SECRET`
  (32+ chars), `ORBETRA_STAGING_HOST=185.80.129.33`, `PUBLIC_API_URL=http://185.80.129.33`.
  compose reads it via `--env-file`.

## Deploy (repeat per release)

```sh
# from the repo root, local machine
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude orbetra_design \
  --exclude 'apps/web/dist' --exclude 'playwright-report' \
  -e "ssh -i ~/.ssh/orbetra_staging" . root@185.80.129.33:/opt/orbetra/app/

ssh -i ~/.ssh/orbetra_staging root@185.80.129.33 '
  cd /opt/orbetra/app/infra/compose &&
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml build app-base &&
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml up -d ingest worker api web caddy &&
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml restart caddy
'
```

## Migrations + seed (idempotent)

```sh
ssh -i ~/.ssh/orbetra_staging root@185.80.129.33 '
  cd /opt/orbetra/app/infra/compose &&
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml \
    run --rm -e DATABASE_URL=postgresql://postgres:$PG_PASSWORD@pg:5432/orbetra api \
    sh -c "cd packages/db && pnpm exec prisma migrate deploy && cd ../.. && tsx packages/db/sql/migrate.ts"
'
# demo tenant (SEED_DEMO_ALLOW required: db/redis hosts are not loopback inside compose)
ssh -i ~/.ssh/orbetra_staging root@185.80.129.33 '
  cd /opt/orbetra/app/infra/compose &&
  docker compose --env-file /opt/orbetra/.env -f docker-compose.yml -f docker-compose.apps.yml \
    run --rm -e SEED_DEMO_ALLOW=1 -e DEMO_PASSWORD="$DEMO_PASSWORD" \
    -e DATABASE_URL=postgresql://postgres:$PG_PASSWORD@pg:5432/orbetra \
    -e REDIS_URL=redis://redis:6379 -e INGEST_HOST=ingest api \
    tsx tools/seed-demo/src/main.ts --yes
'
```

## Verify

- `curl http://185.80.129.33/healthz` → ok (Caddy)
- `curl http://185.80.129.33/v1/branding` → JSON (api through Caddy)
- Login at `http://185.80.129.33` with `demo-admin@orbetra.test`.

## Notes

- HTTP-by-IP is TEMPORARY until DNS (`COOKIE_SECURE=0`); the day orbetra.com points
  here, set `ORBETRA_PUBLIC=true`, `COOKIE_SECURE=1` and use the on-demand-TLS block.
- Ingest is the only app port published beside Caddy (5027 — devices). Internal
  services stay loopback/compose-network only (PR #11: Docker bypasses UFW).
- No CD pipeline yet — this runbook IS the deploy. GitHub Actions CD = follow-up.
