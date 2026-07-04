-- migrate:no-transaction
-- Continuous aggregate from PROJECT_PLAN §6.3 (split from 001 only because caggs
-- cannot be created inside a transaction; SQL content is the spec's, verbatim).
CREATE MATERIALIZED VIEW daily_device_stats WITH (timescaledb.continuous) AS
  SELECT device_id, time_bucket('1 day', fix_time) d,
         count(*) recs, max(odometer_m) odo_max, min(odometer_m) odo_min,
         sum(CASE WHEN ignition THEN 1 ELSE 0 END) ign_samples
  FROM positions WHERE fix_valid GROUP BY device_id, d WITH NO DATA;
SELECT add_continuous_aggregate_policy('daily_device_stats',
  start_offset=>interval '3 days', end_offset=>interval '1 hour', schedule_interval=>interval '1 hour');
