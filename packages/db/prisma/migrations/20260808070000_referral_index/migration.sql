-- The admin registry aggregates every referred tenant on each load (listWithStats), and the accrual
-- path resolves a tenant's referrer on every paid invoice. The FK declared the relation but no index
-- backed it, so both were sequential scans of `tenants` that grow with the whole customer base
-- rather than with one partner's book.
--
-- Plain, not partial, so it matches the `@@index([referredByAffiliateId])` in schema.prisma exactly:
-- a hand-written predicate Prisma cannot express would read as permanent drift to `migrate diff`.
CREATE INDEX IF NOT EXISTS "tenants_referredByAffiliateId_idx"
  ON "tenants" ("referredByAffiliateId");
