#!/usr/bin/env sh
# Infra smoke test (E01-2 AC) — services healthy + contract checks.
# Usage: sh infra/smoke.sh   (after `make up`; CI runs it against ephemeral compose)
set -eu
cd "$(dirname "$0")/compose"

fail() { echo "SMOKE FAIL: $1" >&2; exit 1; }
ok() { echo "  ok: $1"; }

echo "waiting for core services (pg, redis) to be healthy…"
for i in $(seq 1 60); do
  unhealthy=$(docker compose ps --format '{{.Service}} {{.Health}}' pg redis | grep -cv healthy || true)
  [ "$unhealthy" = "0" ] && break
  [ "$i" = "60" ] && fail "pg/redis not healthy after 5 min"
  sleep 5
done
ok "pg + redis healthy"

# Redis contract: noeviction is a BullMQ hard requirement (PROJECT_PLAN §5)
policy=$(docker compose exec -T redis redis-cli CONFIG GET maxmemory-policy | tail -1)
[ "$policy" = "noeviction" ] || fail "maxmemory-policy is '$policy', must be noeviction"
ok "redis maxmemory-policy=noeviction"

aof=$(docker compose exec -T redis redis-cli CONFIG GET appendfsync | tail -1)
[ "$aof" = "everysec" ] || fail "appendfsync is '$aof', must be everysec"
ok "redis appendfsync=everysec"

# Postgres contract: timescaledb + postgis available
exts=$(docker compose exec -T pg psql -U postgres -d orbetra -tAc \
  "SELECT count(*) FROM pg_available_extensions WHERE name IN ('timescaledb','postgis')")
[ "$exts" = "2" ] || fail "timescaledb/postgis extensions missing (got $exts of 2)"
ok "timescaledb + postgis available"

# Caddy up with health endpoint
curl -fsS "http://localhost:${CADDY_HTTP_PORT:-8088}/healthz" >/dev/null 2>&1 || fail "caddy /healthz not responding"
ok "caddy healthz"

# Photon reverse geocode (tolerates long first-boot warmup — skip if still warming).
# Query Warsaw to match the loaded extract (docker-compose.yml COUNTRY_CODE: pl); querying
# a Vilnius/LT point would never resolve until the LT extract is added.
if curl -fsS "http://localhost:2322/reverse?lat=52.2297&lon=21.0122" 2>/dev/null | grep -qiE 'warsz|warsaw'; then
  ok "photon reverse-geocodes Warsaw"
else
  echo "  warn: photon still warming up (first boot downloads the index) — rerun smoke later"
fi

echo "smoke passed"
