# W7-S2 — pgBackRest backups + restore drill

pgBackRest 2.58 is bundled in the `timescaledb-ha` image. Config + scripts live in
`infra/pgbackrest/`, mounted read-only at `/etc/pgbackrest/` in the pg container. The
spilo image sets its own `PGBACKREST_CONFIG` env, so every command passes
`--config=/etc/pgbackrest/pgbackrest.conf` explicitly.

## Repo location

- **Now (staging):** local docker volume `orbetra_pgbackrest_repo` → `/var/lib/pgbackrest`.
  Enough to prove the mechanism + RTO, but **NOT disaster recovery** — a host failure loses
  the backups with the DB.
- **Production (founder-gated, like SES):** a Hetzner **Storage Box** over SFTP. Order the
  box, drop an ssh key at `infra/pgbackrest/storagebox_ed25519` (gitignored), and swap the
  `[global] repo1-*` block per the comment in `pgbackrest.conf`. THIS IS REQUIRED before
  real pilots — a same-disk repo is not a backup.

## One-time setup (done on staging 2026-07-13)

```sh
# 1) enable WAL archiving (needs a pg restart — archive_mode is not reload-able)
docker exec -u postgres orbetra-pg-1 sh /etc/pgbackrest/stanza-create.sh
docker compose ... restart pg
# 2) create + check the stanza (archiving now live)
docker exec -u postgres -e STANZA_ONLY=1 orbetra-pg-1 sh /etc/pgbackrest/stanza-create.sh
```
Result: `archive_mode=on`, `archive_command='pgbackrest … archive-push %p'`, stanza `orbetra`
created, `pgbackrest check` green (WAL segment archived successfully).

## Nightly schedule (host cron on the server)

pgBackRest streams WAL continuously via `archive_command`; add periodic base backups:

```cron
# /etc/cron.d/orbetra-pgbackrest  (server)
# Sunday 02:15 UTC — full; other days 02:15 — incremental. retention keeps 2 fulls.
15 2 * * 0 root docker exec -u postgres orbetra-pg-1 env TYPE=full sh /etc/pgbackrest/backup.sh
15 2 * * 1-6 root docker exec -u postgres orbetra-pg-1 env TYPE=incr sh /etc/pgbackrest/backup.sh
```

## Restore drill (AC: RTO < 30 min DEMONSTRATED)

`infra/pgbackrest/restore-drill.sh` restores the latest backup into a **scratch** container
(never touches live pg), promotes it, verifies row counts, and prints the RTO.

```sh
sh /opt/orbetra/app/infra/pgbackrest/restore-drill.sh
```

**Measured on staging 2026-07-13** (50 MB db, local repo):
```
=== VERIFIED: devices=12 leads=2 trips=72 positions=9261 ===   (matches live)
=== RTO: 4s (0m 4s) — target <1800s (30m) ===  ✓
```

RTO scales with database size + WAL replay depth. 4 s at 50 MB; a production DB (tens of
GB of positions) restores in minutes, still far under 30 min. Re-run the drill after the
DB grows and re-record the number; over a Storage Box, add network-transfer time.

## Manual point-in-time restore (real recovery)

```sh
# stop the app, then on a fresh/empty pgdata:
docker exec -u postgres orbetra-pg-1 pgbackrest --config=/etc/pgbackrest/pgbackrest.conf \
  --stanza=orbetra --type=time "--target=2026-07-13 12:00:00+00" --delta restore
# start pg; it replays WAL to the target, then promote.
```

## Verify state

```sh
docker exec orbetra-pg-1 pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=orbetra info
```
