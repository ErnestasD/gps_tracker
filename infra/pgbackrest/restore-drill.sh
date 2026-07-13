#!/bin/sh
# W7-S2 RESTORE DRILL — restore the latest backup into a SCRATCH postgres, verify the data,
# and print the RTO. Does NOT touch the live pg. Run ON THE SERVER from the compose dir:
#   sh /opt/orbetra/app/infra/pgbackrest/restore-drill.sh
# Requires: the `orbetra` stanza + at least one backup already taken (backup.sh).
set -e
IMAGE="timescale/timescaledb-ha:pg16"   # MUST match the live pg tag (catalog/extension compat) — pin both together
REPO_VOL="orbetra_pgbackrest_repo"        # docker volume holding /var/lib/pgbackrest
CONF="/opt/orbetra/app/infra/pgbackrest"  # host path to pgbackrest.conf
SCRATCH="orbetra-restore-drill"
NET="orbetra_default"
LIVE="orbetra-pg-1"

# always tear the scratch down, even on mid-drill failure (review LOW)
trap 'docker rm -f "$SCRATCH" >/dev/null 2>&1 || true' EXIT

echo "=== W7-S2 restore drill @ $(date -u +%FT%TZ) ==="
docker rm -f "$SCRATCH" >/dev/null 2>&1 || true

# BASELINE from the LIVE db — the drill's green light must depend on the DATA matching,
# not just wall-clock (review HIGH). A structurally-consistent but empty/stale restore
# must FAIL here, not print a cheerful VERIFIED.
BASELINE=$(docker exec "$LIVE" psql -U postgres -d orbetra -tAc "
  SELECT (SELECT count(*) FROM devices)||' '||(SELECT count(*) FROM leads)||' '||(SELECT count(*) FROM trips)||' '||(SELECT count(*) FROM positions);")
echo "→ live baseline (devices leads trips positions): $BASELINE"


START=$(date +%s)

# a scratch container mounting the SAME repo (read-only) + an empty pgdata target
docker run -d --name "$SCRATCH" --network "$NET" \
  -v "${REPO_VOL}:/var/lib/pgbackrest:ro" \
  -v "${CONF}:/etc/pgbackrest:ro" \
  -e POSTGRES_PASSWORD=drill -e PGDATA=/home/postgres/pgdata/data \
  --entrypoint sleep "$IMAGE" 3600 >/dev/null
echo "→ scratch container up; restoring latest backup…"

# restore into the scratch pgdata (delta over the empty dir), then start postgres standalone
docker exec -u postgres "$SCRATCH" sh -c '
  rm -rf /home/postgres/pgdata/data && mkdir -p /home/postgres/pgdata/data && chmod 700 /home/postgres/pgdata/data
  pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=orbetra --delta restore
  # recovery for a restore: promote immediately (we want the DB open, not PITR-following)
  echo "recovery_target_action = '"'"'promote'"'"'" >> /home/postgres/pgdata/data/postgresql.auto.conf
  touch /home/postgres/pgdata/data/recovery.signal
  pg_ctl -D /home/postgres/pgdata/data -o "-c archive_mode=off -c listen_addresses=127.0.0.1" -w -t 120 start
'
echo "→ restored + started; verifying data…"

# wait until it accepts connections + recovery finished
docker exec -u postgres "$SCRATCH" sh -c '
  for i in $(seq 1 60); do psql -h 127.0.0.1 -U postgres -tAc "SELECT NOT pg_is_in_recovery()" 2>/dev/null | grep -q t && break; sleep 1; done
'
RESTORED=$(docker exec -u postgres "$SCRATCH" psql -h 127.0.0.1 -U postgres -d orbetra -tAc "
  SELECT (SELECT count(*) FROM devices)||' '||(SELECT count(*) FROM leads)||' '||(SELECT count(*) FROM trips)||' '||(SELECT count(*) FROM positions);")

END=$(date +%s)
RTO=$((END - START))
echo "=== restored (devices leads trips positions): $RESTORED ==="
echo "=== RTO: ${RTO}s ($((RTO/60))m $((RTO%60))s) — target <1800s (30m) ==="

# HARD gates (review HIGH): data must be present AND consistent with the live baseline
# (the drill restores to end-of-WAL while live keeps writing, so restored >= baseline).
POS=$(echo "$RESTORED" | awk '{print $4}')
DEV=$(echo "$RESTORED" | awk '{print $1}')
BASE_POS=$(echo "$BASELINE" | awk '{print $4}')
FAIL=0
[ "${POS:-0}" -gt 0 ] || { echo "✗ FAIL: positions empty — restore is worthless"; FAIL=1; }
[ "${DEV:-0}" -gt 0 ] || { echo "✗ FAIL: devices empty"; FAIL=1; }
[ "${POS:-0}" -ge "${BASE_POS:-0}" ] || { echo "✗ FAIL: restored positions ($POS) < live baseline ($BASE_POS) — stale/partial backup"; FAIL=1; }
[ "$RTO" -lt 1800 ] || { echo "✗ FAIL: RTO exceeds 30m"; FAIL=1; }
[ "$FAIL" -eq 0 ] && echo "✓ RESTORE DRILL PASSED (data verified against live baseline, RTO in target)" || { echo "✗ RESTORE DRILL FAILED"; exit 1; }
