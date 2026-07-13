#!/bin/sh
# W7-S2 RESTORE DRILL — restore the latest backup into a SCRATCH postgres, verify the data,
# and print the RTO. Does NOT touch the live pg. Run ON THE SERVER from the compose dir:
#   sh /opt/orbetra/app/infra/pgbackrest/restore-drill.sh
# Requires: the `orbetra` stanza + at least one backup already taken (backup.sh).
set -e
IMAGE="timescale/timescaledb-ha:pg16"
REPO_VOL="orbetra_pgbackrest_repo"        # docker volume holding /var/lib/pgbackrest
CONF="/opt/orbetra/app/infra/pgbackrest"  # host path to pgbackrest.conf
SCRATCH="orbetra-restore-drill"
NET="orbetra_default"

echo "=== W7-S2 restore drill @ $(date -u +%FT%TZ) ==="
docker rm -f "$SCRATCH" >/dev/null 2>&1 || true

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
VERIFY=$(docker exec -u postgres "$SCRATCH" psql -h 127.0.0.1 -U postgres -d orbetra -tAc "
  SELECT 'devices='||(SELECT count(*) FROM devices)
       ||' leads='||(SELECT count(*) FROM leads)
       ||' trips='||(SELECT count(*) FROM trips)
       ||' positions='||(SELECT count(*) FROM positions);")

END=$(date +%s)
RTO=$((END - START))
echo "=== VERIFIED: $VERIFY ==="
echo "=== RTO: ${RTO}s ($((RTO/60))m $((RTO%60))s) — target <1800s (30m) ==="
[ "$RTO" -lt 1800 ] && echo "✓ RTO within target" || echo "✗ RTO EXCEEDS 30m"

echo "→ cleaning up scratch container"
docker rm -f "$SCRATCH" >/dev/null
