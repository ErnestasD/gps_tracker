-- Normalize affiliate emails to lowercase (audit MED).
--
-- `affiliates.email` is a plain case-sensitive @unique, and `create` stored whatever was submitted —
-- but the partner login handler lowercases before the lookup, so an affiliate created as
-- `Jonas@Partner.lt` (the natural form pasted from a contract) could set a password via the emailed
-- link and then NEVER log in: the lookup is an exact equality on the unique index. The tenant-user
-- path already normalizes on write (repos/users.ts) and the referral-code lookup was already
-- hardened to lower(code) = lower($1); this path was missed on both sides.
--
-- Collapse existing rows first. A genuine collision (two affiliates differing only in case) would
-- violate the unique index — fail loudly here rather than silently merging two partners' ledgers.
UPDATE "affiliates" SET "email" = lower("email") WHERE "email" <> lower("email");

-- …and keep it that way: a functional unique index makes a future mixed-case insert impossible,
-- the same shape as 20260803220000_affiliate_code_lower_unique did for the referral code.
CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_email_lower_key" ON "affiliates" (lower("email"));
