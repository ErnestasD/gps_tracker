-- `raw_rejects` gains the deviceId the drain already resolved, and `devices` gets its plain IMEI
-- index back.
--
-- WHY deviceId. GDPR device-erase deletes from `raw_rejects` by IMEI, because the table predates
-- device resolution. That was fine while an IMEI was globally unique — but the previous migration
-- made it unique among ACTIVE devices only, so one IMEI can now sit on a retired row AND an active
-- one. Deleting by IMEI then reaches rows that belong to a different device, and (before the
-- cross-tenant guard in `devices.create`) could have reached a different TENANT's rows entirely.
-- The drain already looks the IMEI up to decide whether the device still exists, so it can store
-- the id it matched, and the erase can key on the thing it actually means.
--
-- Nullable: rows written before this column existed have no id, and the erase keeps its IMEI
-- fallback for exactly those (`deviceId IS NULL AND imei = $1`). They age out with the 90-day sweep.
ALTER TABLE "raw_rejects" ADD COLUMN IF NOT EXISTS "deviceId" bigint;
CREATE INDEX IF NOT EXISTS "raw_rejects_deviceId_idx" ON "raw_rejects" ("deviceId");

-- The previous migration dropped `devices_imei_key` and replaced it with a PARTIAL unique index,
-- which no query can use unless it also carries `WHERE "retiredAt" IS NULL` — and neither IMEI
-- lookup does. Measured at 200k devices: `imeisIn` went from a 1.5 ms index-only scan to a 19 ms
-- parallel seq scan, and it runs in the reject drain up to 25 times a minute on the pool the
-- ordered pipeline shares. A plain non-unique index restores the lookup; the partial one keeps
-- enforcing correctness.
CREATE INDEX IF NOT EXISTS "devices_imei_idx" ON "devices" ("imei");
