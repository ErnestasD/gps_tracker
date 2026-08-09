-- Deal registration (§6.9): a partner claims a prospect BEFORE that prospect signs up.
--
-- The control a serious B2B partner asks for first — they introduce a fleet in person, the fleet
-- later types our address into a browser, and without this the partner earns nothing. Approval is
-- the anti-land-grab control: without it, one partner registers every large company in the country
-- on their first afternoon.
DO $$ BEGIN
  CREATE TYPE "DealStatus" AS ENUM ('pending', 'approved', 'rejected', 'converted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "deal_registrations" (
  "id"                UUID PRIMARY KEY,
  "affiliateId"       UUID NOT NULL,
  "company"           TEXT NOT NULL,
  -- the matching key, stored lowercased. Free-mail domains are refused at creation: one approved
  -- claim on gmail.com would silently take every self-serve signup on the platform.
  "domain"            TEXT NOT NULL,
  "contactName"       TEXT,
  "contactEmail"      TEXT,
  "note"              TEXT,
  "status"            "DealStatus" NOT NULL DEFAULT 'pending',
  "reason"            TEXT,
  -- set on approval; a claim that outlives it attributes nothing. Expiry is DERIVED at read time,
  -- not swept — a status that has to be aged by a cron is wrong between runs.
  "expiresAt"         TIMESTAMPTZ,
  "reviewedAt"        TIMESTAMPTZ,
  "reviewedBy"        UUID,
  "convertedTenantId" UUID,
  "convertedAt"       TIMESTAMPTZ,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "deal_registrations_affiliateId_fkey" FOREIGN KEY ("affiliateId")
    REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- signup resolves a claim by domain on every unattributed registration
CREATE INDEX IF NOT EXISTS "deal_registrations_domain_status_idx" ON "deal_registrations" ("domain", "status");
CREATE INDEX IF NOT EXISTS "deal_registrations_affiliateId_createdAt_idx" ON "deal_registrations" ("affiliateId", "createdAt");
