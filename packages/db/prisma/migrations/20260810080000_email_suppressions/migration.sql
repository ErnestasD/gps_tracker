-- Addresses we must stop mailing, learned from SES bounce/complaint events.
--
-- A bounce was invisible to the platform: SES told a human inbox and nothing in the system knew. The
-- expensive case is the billing lapse ladder, which advances on SEND rather than delivery — a
-- customer whose billing contact address is dead was recorded as warned three times and then had
-- their fleet cut off, having been warned into a void.
DO $$ BEGIN
  CREATE TYPE "SuppressionReason" AS ENUM ('bounce', 'complaint');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "email_suppressions" (
  -- the ADDRESS is the key, not a user id: partners and account contacts have no user row, and the
  -- reason to stop is a fact about the mailbox either way
  "address"   TEXT PRIMARY KEY,
  "reason"    "SuppressionReason" NOT NULL,
  "detail"    TEXT,
  "messageId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
