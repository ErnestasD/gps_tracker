-- Device profiles become device MODELS.
--
-- The picker offered four profiles while Teltonika ships ~105 trackers with an AVL page, and the
-- profile did not decide anything about decoding: `normalize()` had a defaulted dictionary family
-- and its only caller passed undefined, so every device decoded against the FMB1xx table whatever
-- the operator picked. On the live wiki tables 11 of the 180 ids TAT100 shares with FMB120 mean
-- something else, so a TAT tamper-detection event was stored as "Agricultural State Flags P4".
--
-- `avlTable` is what closes that: it names the generated dictionary (packages/codec/dictionaries)
-- that decodes this model. 105 models resolve to ~34 tables, because the wiki's master template
-- takes no parameters and 45 model pages render a byte-identical table.
ALTER TABLE device_profiles ADD COLUMN "avlTable" text NOT NULL DEFAULT 'fmb120';
-- The exact model code as printed on the device, e.g. 'FMC650'. NULL on the four legacy rows,
-- which name a family rather than a model.
ALTER TABLE device_profiles ADD COLUMN "model" text;
-- What this model can do, from the wiki rather than from marketing: {"can":true,"ble":true,...}.
ALTER TABLE device_profiles ADD COLUMN "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Kept, not deleted: devices already reference these rows, and dropping them would orphan a live
-- fleet. Hidden from the picker; a device already on one keeps working and is migrated separately.
ALTER TABLE device_profiles ADD COLUMN "legacy" boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX device_profiles_model_key ON device_profiles ("model") WHERE "model" IS NOT NULL;

-- Point the four legacy rows at the table that actually decodes them. Until now they all decoded as
-- FMB1xx; tat-asset and fmb6xx-stub were being mislabelled outright.
UPDATE device_profiles SET "avlTable" = 'fmb120', "legacy" = true WHERE key IN ('fmb1xx', 'fmc');
UPDATE device_profiles SET "avlTable" = 'fmb640', "legacy" = true WHERE key = 'fmb6xx-stub';
UPDATE device_profiles SET "avlTable" = 'tat100', "legacy" = true WHERE key = 'tat-asset';
