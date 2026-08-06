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
-- …and WHICH lapse that stage belongs to. Without it the stage is a property of the tenant rather
-- than of the episode, and the majority path breaks: a customer who walks the whole ladder and then
-- pays on day +2 — before suspension — keeps stage 3 forever, so their NEXT lapse skips every
-- warning and cuts them off on day +3 with a single "it already stopped" email. The same carry-over
-- fires when any stray `customer.subscription.*` resets `lastBillingEventAt` while the stage stands.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "lapseNoticeFor"   TIMESTAMPTZ;

-- Suspension is REVERSIBLE and must be found fast on the paying path: the webhook restores service
-- the moment a payment lands, and the sweep re-checks every suspended tenant. Partial, because the
-- overwhelming majority of rows are NULL.
-- PARTIAL, and deliberately NOT declared in schema.prisma: Prisma cannot express a partial index, so
-- an `@@index([suspendedAt])` there would describe a different (full) index under the same name and
-- every later `migrate dev` would try to create it and fail with "already exists".
CREATE INDEX IF NOT EXISTS "tenants_suspendedAt_idx" ON "tenants" ("suspendedAt") WHERE "suspendedAt" IS NOT NULL;
