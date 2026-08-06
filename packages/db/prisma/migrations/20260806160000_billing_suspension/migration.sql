-- Lapse enforcement: warn, then suspend (audit MED #22, founder policy 2026-08-06).
--
-- The entitlement floor was enforced only at device CREATE, so a canceled subscription or an expired
-- trial changed exactly one thing the customer could perceive — "you cannot add another device" —
-- while the fleet kept tracking at our storage cost, indefinitely, for free. The previous release
-- made that set countable; this one acts on it, on the schedule the founder set:
--
--   grace period ends  →  notice 1  ("service stops in 3 days")
--   +1 day             →  notice 2
--   +2 days            →  notice 3  (final)
--   +3 days            →  SUSPEND — the ingest registry is torn down and the meter stops
--
-- `lapseNoticeStage` is what makes the daily job idempotent: it records which notice has been sent,
-- so a job that runs twice, or a worker restarted mid-sweep, cannot mail the same customer twice or
-- skip the final warning before cutting them off.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "suspendedAt"      TIMESTAMPTZ;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "lapseNoticeStage" INTEGER NOT NULL DEFAULT 0;

-- Suspension is REVERSIBLE and must be found fast on the paying path: the webhook restores service
-- the moment a payment lands, and the sweep re-checks every suspended tenant. Partial, because the
-- overwhelming majority of rows are NULL.
CREATE INDEX IF NOT EXISTS "tenants_suspendedAt_idx" ON "tenants" ("suspendedAt") WHERE "suspendedAt" IS NOT NULL;
