# W7-S2 Plan — pgBackRest backups + restore drill

> PROJECT_PLAN §8 S2: „pgBackRest + **restore drill on scratch server (AC: documented runbook, RTO <30 min demonstrated)**". §6 backups: „pgBackRest → Hetzner Storage Box, nightly full + WAL". Autonominė sesija.

## Kontekstas (nužvalgyta)

- **pgBackRest 2.58 JAU bundled** timescale/timescaledb-ha image'e (`/usr/bin/pgbackrest`) — jokio atskiro image'o.
- pg konteineris: uid 1000 postgres, `PGDATA=/home/postgres/pgdata/data`, `archive_mode=off`.
- **Storage Box (SFTP repo) = founder-gated** (dar neužsakytas — runbook Hetzner sako „order later"). Tad V1 default = **lokalus repo** volume'e ant staging box (`/var/lib/pgbackrest`); Storage Box SFTP = dokumentuotas prod swap (`repo1-type=sftp`, kaip SES/Telegram pattern). Restore drill'ui lokalaus repo pilnai pakanka RTO įrodyti.

## Sprendimas

1. **pgbackrest.conf** (`infra/pgbackrest/pgbackrest.conf`, mount į pg konteinerį `/etc/pgbackrest/pgbackrest.conf`): stanza `orbetra`, `repo1-path=/var/lib/pgbackrest`, `repo1-retention-full=2`, `repo1-bundle=y`, `compress-type=zst`, `pg1-path=/home/postgres/pgdata/data`. Prod-swap komentaras: `repo1-type=sftp` + Storage Box host/user/key.
2. **Repo volume** `pgbackrest_repo:/var/lib/pgbackrest` pg servise (compose).
3. **Archive įjungimas** (WAL archiving, PITR): postgresql conf drop-in per `ALTER SYSTEM` + kontroliuojamas restart — `archive_mode=on`, `archive_command='pgbackrest --stanza=orbetra archive-push %p'`, `wal_level=replica` (jau replica), `archive_timeout=60`. Restart valdomas (staging demo trumpai nutrūks — dokumentuota).
4. **Scriptai** (`infra/pgbackrest/`): `stanza-create.sh` (vienkartinis), `backup.sh` (full|incr), `restore-drill.sh` (restore į SCRATCH konteinerį + verify + RTO matavimas — NELiečia live pg).
5. **Nightly cron**: dokumentuotas host cron / systemd timer (full sekmadieniais, incr kasdien + WAL nuolat per archive_command). Compose sidecar cron = follow-up; runbook duoda crontab eilutes.
6. **Restore drill** (AC esmė): full backup → scratch postgres konteineris mount'ina repo read-only → `pgbackrest restore` į tuščią pgdata → start → verify (demo tenant: databases count, leads, devices, positions count) → **RTO = wall-clock nuo restore start iki verified**. Tikslas <30 min.

## Failai

**Nauji:** infra/pgbackrest/{pgbackrest.conf, stanza-create.sh, backup.sh, restore-drill.sh}; docs/runbooks/w7-pgbackrest.md (setup + nightly + restore drill su išmatuotu RTO); docs/epics/W7-S2-pgbackrest-plan.md.
**Keičiami:** infra/compose/docker-compose.yml (pg: mount conf + repo volume; +pgbackrest_repo volume); README (backup pastaba); staging .env pastaba (Storage Box creds — founder).

## Verifikacija (DoD)

- **RTO <30 min DEMONSTRUOTAS** ir įrašytas runbook'e (tikras restore drill ant staging).
- Restore'inti duomenys sutampa su originalu (row counts: leads, devices, positions, trips).
- `pgbackrest info` rodo full backup + WAL archyvą.
- Runbook: setup, nightly schedule, restore procedūra, Storage Box swap.

## Rizikos

- **Live pg restart** archive_mode įjungimui — staging demo ~30s downtime (dokumentuota; prod = maintenance window arba nuo pradžių įjungta).
- **Storage Box BLOCKED**: lokalus repo tos pačios mašinos diske = NE tikras disaster recovery (mašina krenta → repo dingsta). Storage Box SFTP = privaloma prod prieš pilotus; dokumentuota kaip founder-gated blocker.
- **timescaledb + PITR**: hypertable chunk'ai = normalūs pg failai, pgBackRest juos backup'ina kaip bet ką; jokio specialaus handling (patvirtinta drill'e).
- **Spilo/Patroni**: image ha, bet single-node standalone (ne Patroni cluster) — ALTER SYSTEM archive_command veiks; jei Patroni perrašytų, fallback = conf drop-in per SPILO env (dokumentuota).
