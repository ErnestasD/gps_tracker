-- One CLOSED trip per (device, startTime) — the natural key of a trip (audit MED, finding #40).
--
-- Recompute is DELETE-then-rebuild. It now deletes only the trip IDs it captured when it read its
-- source positions, so a trip the STREAMING persister closes mid-job is no longer erased and never
-- rebuilt. The other half of that fix needs this index: the rebuild would otherwise re-create that
-- same trip from the same positions and leave the device with two rows for one journey. With the
-- index the insert is `ON CONFLICT DO NOTHING` and the streamed row simply wins — both describe the
-- same trip, so either is correct and a duplicate is not.
--
-- PARTIAL (`WHERE status='closed'`): an open row is a live trip owned by the streaming persister and
-- must never be constrained against a rebuilt one. Two closed trips of one device cannot begin at
-- the same instant, so this cannot reject legitimate data.
--
-- CONCURRENTLY is deliberately NOT used: `prisma migrate deploy` runs each file in a transaction,
-- and the table is small (one row per journey, unlike positions).
CREATE UNIQUE INDEX IF NOT EXISTS "trips_device_start_closed_key"
  ON "trips" ("deviceId", "startTime")
  WHERE "status" = 'closed';
