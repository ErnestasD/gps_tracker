-- An event was a POINT IN TIME, and for a condition that lasts that is the wrong shape.
--
-- A vehicle crossing 90 and climbing to 155 produced one row saying "95 km/h" — the speed at the
-- instant it first crossed — and then, every cooldown window, another row with whatever the speed
-- happened to be at that moment. Five rows five minutes apart were not five violations; they were
-- one breach sliced by a timer, and not one of them carried the worst moment or how long it lasted.
-- The customer could see that a driver had sped, and never how much or for how long.
--
-- `endedAt` is the LAST moment the same condition was observed. NULL means a single instant (an
-- edge event like panic or ignition, which genuinely has no duration) — not "still running", so
-- nothing has to sweep the table to close anything.
ALTER TABLE "events" ADD COLUMN "endedAt" TIMESTAMPTZ;

-- A continuation has to find the row it extends: newest open row for this device + kind (+ rule).
-- Partial, because only rows that can still be extended are worth indexing, and the table is a
-- hypertable that grows forever.
CREATE INDEX "events_open_idx" ON "events" ("deviceId", "kind", "at" DESC) WHERE "endedAt" IS NULL;
