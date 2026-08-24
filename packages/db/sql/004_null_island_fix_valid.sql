-- Repair the rows that reached the database before the null-island guard existed.
--
-- PROJECT_PLAN §3.4 is wiki-verified and models one no-fix shape: last valid coordinates with
-- satellites = 0, hence `fix_valid := satellites > 0`. On 2026-08-20 an FTC887 produced another —
-- lat 0, lon 0, with 34-37 satellites — and fifty such rows were stored as VALID fixes. The write
-- path is fixed (apps/worker/src/normalize.ts), but a write-path fix does nothing for rows already
-- written, and on the read side `fix_valid` is what every consumer trusts:
--
--   * readLatestValidPosition — the PUBLIC share link. A device whose newest valid row is 0/0 parks
--     a customer-facing marker in the Gulf of Guinea.
--   * trip distance and max-speed SQL (apps/worker/src/trip/persister.ts), which filter on fix_valid
--   * the GDPR export
--
-- WHAT THIS DOES NOT REPAIR, stated plainly so nobody assumes otherwise:
--
--   * `trips`. Distance, max speed and endLat/endLon are computed at close time and PERSISTED
--     (trip/persister.ts closeTrip). Flipping fix_valid afterwards changes nothing already closed:
--     a phantom trip keeps its null-island endpoint and its ~6000 km until someone enqueues a
--     recompute for that device and window. That is an operator step, not this file.
--   * `daily_device_stats`. 002 sets start_offset => 3 days, so rows repaired 3-14 days back are
--     never re-materialized. Nothing in production reads that cagg today.
--
-- WINDOW. Bounded to 14 days of fix_time, which is the hypertable's partitioning column and the
-- column `compress_after` measures (001). Chunk exclusion therefore guarantees this UPDATE cannot
-- land in a compressed chunk: show_chunks(older_than) only returns chunks whose data is ENTIRELY
-- older than the cutoff, so any chunk holding a row inside the window is uncompressed by
-- construction.
--
-- The converse is NOT true, and an earlier draft of this header claimed it was: compression is a
-- background job, so chunks older than 14 days are routinely still uncompressed, and a row older
-- than the window is not "beyond the compression boundary" — it is merely outside what this file
-- dares touch without an ADR-008-style decompress path.
--
-- That leaves a real gap: a device that buffered while offline flushes OLD-timestamped fixes on
-- reconnect (003's header records this exact trap costing us billing accuracy), so a 0/0 received
-- yesterday can carry a fix_time from last month and sit outside this window. Rather than guess,
-- the DO block COUNTS them and says so. An operator who sees a non-zero count knows the real size
-- of the problem instead of inheriting this file's assumption that it is fifty.
--
-- RE-RUNNING. This is a one-shot: migrate.ts records the file in schema_migrations and skips it
-- forever after, and rule 11 plus the checksum abort mean it cannot be edited to widen the window.
-- A second repair needs a NEW numbered file. Deploy order matters for the same reason — roll the
-- worker out BEFORE running this, or the gap between them writes fresh unrepaired rows that
-- `make migrate` will then refuse to look at again.
DO $$
DECLARE
  repaired bigint;
  outside  bigint;
BEGIN
  UPDATE positions
     SET fix_valid = false
   WHERE lat = 0
     AND lon = 0
     AND fix_valid = true
     AND fix_time > now() - interval '14 days';
  GET DIAGNOSTICS repaired = ROW_COUNT;

  SELECT count(*) INTO outside
    FROM positions
   WHERE lat = 0
     AND lon = 0
     AND fix_valid = true;

  RAISE NOTICE '004 null-island repair: % row(s) fixed within 14 days', repaired;
  IF outside > 0 THEN
    RAISE NOTICE '004 null-island repair: % row(s) STILL invalid-but-valid outside the window '
                 '(buffered flushes carry old fix_time) — a wider repair needs a new numbered file', outside;
  END IF;
END $$;
