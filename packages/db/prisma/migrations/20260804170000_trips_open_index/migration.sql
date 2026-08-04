-- PARTIAL index on the open-trip set (audit high follow-up).
--
-- The worker's startup warm-start and orphan sweep both filter `status='open'`, and `trips` has no
-- retention — so without this they are full scans that grow forever, run before the pipeline starts,
-- while ingest keeps XADDing into MAXLEN-trimmed streams. Partial rather than a plain index on
-- `status`: closed trips are ~100% of the table and never queried this way, so the index stays tiny
-- (one entry per vehicle currently moving) and costs nothing to maintain on close.
CREATE INDEX IF NOT EXISTS "trips_open_idx" ON "trips" ("deviceId") WHERE "status" = 'open';
