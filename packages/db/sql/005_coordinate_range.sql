-- Make "a coordinate is on the sphere" structural, not a property of whichever producer wrote the row.
--
-- WHAT IS ALREADY TRUE, stated first because the first draft of this header got it wrong and a
-- migration is permanent: off-sphere coordinates are refused at ingest today and always have been.
-- `sanityFailure` (apps/ingest/src/persist.ts:27) returns 'coords' for |lat| > 90 or |lon| > 180 and
-- `persistAvlBatch` diverts those records to the `rejects` stream, so nothing reaching the worker
-- carries one. This constraint does not close a live hole.
--
-- WHAT IT IS FOR. 001 declares lat/lon `double precision NOT NULL` with no CHECK, so the TABLE would
-- accept anything a producer that bypasses ingest hands it — a replay or backfill tool, a test
-- harness, or the next vendor decoder written by someone who never opens persist.ts. The guard in
-- apps/worker/src/normalize.ts (`onSphere`) is the same invariant one layer up; this is the half
-- that survives a future edit to that file.
--
-- THE CASE THAT MADE IT WORTH WRITING. Ruptela's Mode-B no-fix record carries satellites 0xFF and
-- lat = lon = 0x80000000 = -214.7483648, verified byte-exactly against the capture in
-- https://github.com/traccar/traccar/issues/5152 (29 records, CRC-16/KERMIT over the frame checks
-- out). It defeats BOTH of our value-level guards — `satellites > 0` and the exact-0/0 rule — which
-- is what a sentinel outside the sphere always will do. The decoder must translate it to 0/0 with
-- satellites 0; these two layers are what stands if it does not.
--
-- NOT VALID, deliberately. It enforces every INSERT from the moment it lands and skips the
-- validation scan over existing chunks. `positions` is a compressed hypertable (001 sets
-- compress_after) and we do not know history is clean — 004's own footer records that buffered
-- flushes carry old fix_time and sit outside any window a repair dares touch. Extending the
-- guarantee backwards is `VALIDATE CONSTRAINT` in a maintenance window, chosen by a person who then
-- finds out what history actually holds — not a side effect of a deploy. The test in
-- packages/db/__tests__/migrate.spec.ts plants a violating row BEFORE this file runs and proves the
-- migration still applies, because "NOT VALID skips the scan" is a claim, and an untested claim in a
-- migration is how a deploy stops at 03:00.
--
-- WHAT THIS DOES NOT DO: it repairs nothing. The DO block COUNTS existing off-sphere rows and says
-- the number out loud, so "there should be none" is measured rather than assumed. Repairing any it
-- finds needs a new numbered file and a decision about what the right coordinate would even be.
--
-- DEPLOY ORDER: roll the worker out BEFORE running this. Postgres refuses an off-sphere INSERT
-- outright; the worker guard is what turns such a record into a stored, marked-invalid row instead.
-- A rejected row is not lost either way — apps/worker/src/consumer.ts quarantines SQLSTATE 23514 to
-- `raw:dead` with its original payload and writes the rest of the batch — but a quarantined row is
-- a support ticket, and a marked-invalid one is a fact on the screen.
DO $$
DECLARE
  offsphere bigint;
BEGIN
  SELECT count(*) INTO offsphere
    FROM positions
   WHERE lat NOT BETWEEN -90 AND 90
      OR lon NOT BETWEEN -180 AND 180;

  IF offsphere > 0 THEN
    RAISE NOTICE '005 coordinate range: % existing row(s) are OFF-SPHERE — the constraint is added '
                 'NOT VALID so they stay readable; repairing them needs a new numbered file', offsphere;
  ELSE
    RAISE NOTICE '005 coordinate range: no existing row is off-sphere (checked, not assumed)';
  END IF;
END $$;

ALTER TABLE positions
  ADD CONSTRAINT positions_coords_on_sphere
  CHECK (lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180) NOT VALID;
