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
# /etc/cron.d/orbetra-pgbackrest  (server) — cron has a minimal PATH, so use ABSOLUTE
# docker (verify: `command -v docker`) and log output; a bare `docker` silently fails.
PATH=/usr/local/bin:/usr/bin:/bin
# Sunday 02:15 UTC — full; other days — incremental. retention keeps 2 fulls + their WAL.
15 2 * * 0 root docker exec -u postgres orbetra-pg-1 env TYPE=full sh /etc/pgbackrest/backup.sh >> /var/log/pgbackrest-cron.log 2>&1
15 2 * * 1-6 root docker exec -u postgres orbetra-pg-1 env TYPE=incr sh /etc/pgbackrest/backup.sh >> /var/log/pgbackrest-cron.log 2>&1
```

**Recoverable window:** `repo1-retention-full=2` keeps the last 2 full backups + all WAL
back to the older one. With 1 full/week that's ≈ up to 2 weeks of PITR. Want deeper —
raise retention (and size the repo/Storage Box accordingly).

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
GB of positions) restores in minutes, still far under 30 min. **This 4 s is data-restore
time only** — real service RTO also includes detection, decision, provisioning a target
host, and app cutover. Re-run the drill after the DB grows and re-record; over a Storage
Box, add network-transfer time. The drill now asserts restored row counts against a LIVE
baseline (non-zero + ≥ baseline) and exits non-zero on mismatch — a green drill means the
DATA came back, not just that a process ran.

## ⚠ archive_mode=on failure mode (READ THIS)

Enabling WAL archiving means **live write availability now depends on `archive-push`
succeeding**. If the repo fills or (after the Storage Box swap) becomes unreachable,
`archive_command` fails, WAL accumulates in `pg_wal`, the disk fills, and PostgreSQL
**stops accepting writes** — taking ingest down with it.

Alerts cover it: `WalArchiveFailing` (critical, pg_stat_archiver failure rate) and
`WalDirGrowing` (warning, no WAL archived >15m), plus `DiskFillingUp`. **First response**
if archiving is broken and the disk is climbing:
```sh
docker exec orbetra-pg-1 psql -U postgres -c "ALTER SYSTEM SET archive_command = '/bin/true';"
docker exec orbetra-pg-1 psql -U postgres -c "SELECT pg_reload_conf();"
```
This keeps the DB up (WAL recycles) at the cost of a gap in archived WAL — fix the repo,
then restore archiving and take a fresh full backup to re-anchor PITR.

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
