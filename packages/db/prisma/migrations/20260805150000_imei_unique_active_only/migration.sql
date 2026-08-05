-- IMEI is unique among ACTIVE devices only (audit MED #55).
--
-- It was globally unique with no exception for retired rows, and `retire` is a soft delete — so a
-- tracker that came back from a customer could never be registered again, by that tenant or any
-- other, and a mis-clicked retire was unrecoverable (there is no un-retire path). Returned hardware
-- is normal in this business; a permanent global claim on a serial number is not.
--
-- Retiring the device therefore FREES its IMEI, which is what an operator expects the word to mean,
-- while two ACTIVE devices still cannot share one.
--
-- Consequence worth knowing: `raw_rejects` keys on IMEI (its rows predate device resolution), so
-- after re-registration a GDPR erase of the NEW device also removes the old device's rejections.
-- Those are 90-day diagnostics for a device that was retired and erased anyway, and deleting too
-- much personal data is the safe direction.
DROP INDEX IF EXISTS "devices_imei_key";
CREATE UNIQUE INDEX IF NOT EXISTS "devices_imei_active_key" ON "devices" ("imei") WHERE "retiredAt" IS NULL;
