#!/bin/sh
# Take a backup (W7-S2). TYPE=full|incr|diff (default full).
# docker exec -u postgres orbetra-pg-1 sh /etc/pgbackrest/backup.sh
set -e
TYPE="${TYPE:-full}"
pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=orbetra --type="${TYPE}" backup
pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=orbetra info
