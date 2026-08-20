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
--   * daily_device_stats, the continuous aggregate
--   * the GDPR export
--
-- Bounded to 14 days on purpose: `compress_after` is 14 days, so every affected chunk is still
-- uncompressed and this is an ordinary UPDATE rather than a decompress-rewrite of 13 months. The
-- device that produced them has been reporting for two days, so the bound covers all of them; a row
-- older than that is beyond the compression boundary and not worth rewriting history for.
--
-- Idempotent: re-running matches nothing once the rows are corrected.
UPDATE positions
   SET fix_valid = false
 WHERE lat = 0
   AND lon = 0
   AND fix_valid = true
   AND fix_time > now() - interval '14 days';
