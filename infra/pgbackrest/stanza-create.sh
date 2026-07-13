#!/bin/sh
# One-time: enable WAL archiving + create the pgBackRest stanza (W7-S2).
# Run ON THE SERVER: docker exec -u postgres orbetra-pg-1 sh /etc/pgbackrest/stanza-create.sh
set -e
echo "→ enabling archive_mode + archive_command (needs a pg restart)"
psql -U postgres -c "ALTER SYSTEM SET archive_mode = 'on';"
psql -U postgres -c "ALTER SYSTEM SET archive_command = 'pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=orbetra archive-push %p';"
psql -U postgres -c "ALTER SYSTEM SET archive_timeout = '60s';"
psql -U postgres -c "ALTER SYSTEM SET max_wal_senders = '3';"
echo "→ restart the pg CONTAINER now (archive_mode needs a full restart), then re-run with STANZA_ONLY=1"
if [ "${STANZA_ONLY:-0}" != "1" ]; then
  echo "   (skipping stanza-create until archive_mode is live — set STANZA_ONLY=1 after restart)"
  exit 0
fi
mkdir -p /var/lib/pgbackrest
pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=orbetra stanza-create
pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=orbetra check
echo "✓ stanza created + checked"
