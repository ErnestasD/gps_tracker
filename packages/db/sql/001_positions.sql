-- positions hypertable — PROJECT_PLAN §6.3 DDL verbatim (raw-SQL territory, CLAUDE.md rule 1)
-- (extension bootstrap is environment setup, not part of the spec DDL)
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE positions (
  device_id   bigint       NOT NULL,
  fix_time    timestamptz  NOT NULL,
  server_time timestamptz  NOT NULL DEFAULT now(),
  lat double precision NOT NULL, lon double precision NOT NULL,
  altitude smallint, speed smallint, course smallint,
  satellites smallint, fix_valid boolean NOT NULL,
  ignition boolean, movement boolean,
  odometer_m bigint, priority smallint NOT NULL DEFAULT 0,
  rec_hash bigint NOT NULL,
  attrs jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (device_id, fix_time, rec_hash)
);
SELECT create_hypertable('positions','fix_time', chunk_time_interval => interval '1 day');
-- course column stores the protocol's "Angle" field (name normalized; document in codec mapper)
ALTER TABLE positions SET (timescaledb.compress,
  timescaledb.compress_segmentby='device_id', timescaledb.compress_orderby='fix_time');
SELECT add_compression_policy('positions', compress_after => interval '14 days');
-- 14d (not 7d): buffered floods from devices offline >compress_after would insert into COMPRESSED
-- chunks; support for that + unique-constraint enforcement is TimescaleDB-version-dependent.
-- W1 verification task: prove insert-into-compressed works with our PK on the pinned TS version;
-- recompute path may decompress_chunk() as fallback. (Audit R8-2)
SELECT add_retention_policy('positions', drop_after => interval '13 months');
-- Retention is PLATFORM-WIDE by design: chunks are time-partitioned across ALL tenants, so
-- per-tenant retention cannot drop chunks. One global raw-retention (13 mo) with cheap chunk
-- drops; tenants may configure SHORTER retention (delete-by-device job, V2) but never longer
-- than platform max without a custom plan that raises the global value. (ADR-007, Audit R8-3)
