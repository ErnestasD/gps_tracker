-- Foreign keys for the two config tables that had none (audit MED #50, #51).
--
-- WHY IT MATTERS. Both are read by BACKGROUND jobs, not by a scoped API read, so an orphan row is
-- invisible to the product while still doing work:
--   * `scheduled_reports` — the worker's hourly cron ran the report and E-MAILED an ex-customer's
--     recipients, indefinitely, about an account that no longer exists. Every API read is scoped by
--     tenant, so there was no surface on which to see or delete the row.
--   * `push_subscriptions` — a `webpush` rule channel fans out to the ACCOUNT's rows, so a removed
--     employee's browser kept receiving that account's vehicle positions and geofence alerts for as
--     long as the browser held the subscription. The USER cascade is the important one: deleting the
--     person is the action an operator actually takes.
--
-- ORPHANS ARE DELETED FIRST. `ADD CONSTRAINT ... REFERENCES` validates existing rows, so on any
-- database that already holds one orphan the ALTER fails — and a failed migration blocks every later
-- one (P3009) until someone runs `prisma migrate resolve` against the live database. These rows are
-- orphans precisely because their tenant/account/user is gone: there is nothing to preserve, and
-- leaving them is the bug.
DELETE FROM "scheduled_reports" sr
 WHERE NOT EXISTS (SELECT 1 FROM "tenants"  t WHERE t.id = sr."tenantId")
    OR NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a.id = sr."accountId");

DELETE FROM "push_subscriptions" ps
 WHERE NOT EXISTS (SELECT 1 FROM "tenants"  t WHERE t.id = ps."tenantId")
    OR NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a.id = ps."accountId")
    OR NOT EXISTS (SELECT 1 FROM "users"    u WHERE u.id = ps."userId");

-- Indexes on the referencing columns: without them every tenant/account/user DELETE takes a
-- sequential scan of these tables to enforce the cascade.
CREATE INDEX IF NOT EXISTS "scheduled_reports_tenantId_idx"   ON "scheduled_reports" ("tenantId");
CREATE INDEX IF NOT EXISTS "scheduled_reports_accountId_idx"  ON "scheduled_reports" ("accountId");
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx"    ON "push_subscriptions" ("userId");

ALTER TABLE "scheduled_reports"
  ADD CONSTRAINT "scheduled_reports_tenantId_fkey"  FOREIGN KEY ("tenantId")  REFERENCES "tenants"("id")  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "scheduled_reports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_tenantId_fkey"  FOREIGN KEY ("tenantId")  REFERENCES "tenants"("id")  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "push_subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "push_subscriptions_userId_fkey"    FOREIGN KEY ("userId")    REFERENCES "users"("id")    ON DELETE CASCADE ON UPDATE CASCADE;
