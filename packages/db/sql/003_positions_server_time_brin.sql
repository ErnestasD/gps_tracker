-- Usage-metering accuracy (audit P4). The hourly billable-device-day sweep must count records that
-- were RECEIVED recently even when their fix_time is old: a device that buffered while offline flushes
-- old-timestamped fixes on reconnect (server_time = ingest receive time, fix_time = when it happened).
-- The sweep previously windowed on fix_time and so MISSED any buffered day older than its 48h lookback
-- → the offline device's usage was silently under-billed. It now windows on server_time, which needs an
-- index. BRIN is ideal: positions are append-ordered by server_time (`DEFAULT now()`), so a block-range
-- index is tiny and nearly free to maintain, and the sweep's server_time range scan prunes to the last
-- few blocks. TimescaleDB propagates the index to every chunk + defaults it on new chunks.
CREATE INDEX IF NOT EXISTS positions_server_time_brin ON positions USING brin (server_time);
