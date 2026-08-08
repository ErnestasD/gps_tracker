-- Daily unique clicks on a partner's short link (`/r/<code>`).
--
-- One row per partner per UTC day, incremented in place. A row-per-click table hanging off a public
-- unauthenticated URL is a disk-fill waiting to happen, and a partner does not want a list of hits —
-- they want to know how many people opened their link, which is a number per day.
CREATE TABLE IF NOT EXISTS "affiliate_clicks" (
  "affiliateId" UUID NOT NULL,
  "day"         DATE NOT NULL,
  "clicks"      INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("affiliateId", "day"),
  CONSTRAINT "affiliate_clicks_affiliateId_fkey" FOREIGN KEY ("affiliateId")
    REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
