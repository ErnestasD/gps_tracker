-- Billing correctness: a report log for the overage meter, a same-second webhook tiebreak, and a
-- frozen affiliate commission window (audit MED #21, #25, #26).

-- ── #21 · what has ALREADY been reported to Stripe's meter, per tenant-day ────────────────────────
-- The reporter submitted exactly one value per (customer, day) and kept no record of it, so the day
-- it ran was the only chance that day ever had: a failed run, a worker restart, or a device that
-- flushed its buffer after midnight was revenue lost for good. With the CUMULATIVE reported value
-- stored, each run can re-walk a trailing window and submit only the DELTA — the additive meter then
-- converges on the truth no matter when the usage rows landed.
--
-- `reported` is the cumulative overage-device count reported for that day, NOT the delta: a delta log
-- cannot answer "what does Stripe think it has" after a partial failure without summing history.
CREATE TABLE IF NOT EXISTS "usage_reports" (
  "tenantId"   UUID        NOT NULL,
  "day"        DATE        NOT NULL,
  "reported"   INTEGER     NOT NULL,
  "reportedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "usage_reports_pkey" PRIMARY KEY ("tenantId", "day")
);

-- Cascade: a deleted tenant's report log is meaningless, and the PK's leading column already serves
-- the cascade lookup, so no extra index is needed.
ALTER TABLE "usage_reports"
  DROP CONSTRAINT IF EXISTS "usage_reports_tenantId_fkey";
DELETE FROM "usage_reports" ur WHERE NOT EXISTS (SELECT 1 FROM "tenants" t WHERE t.id = ur."tenantId");
ALTER TABLE "usage_reports"
  ADD CONSTRAINT "usage_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── #25 · same-second Stripe event tiebreak ───────────────────────────────────────────────────────
-- `event.created` is Unix SECONDS. The monotonic guard is `lastBillingEventAt < eventAt`, so a second
-- event genuinely emitted in the same second as the first — Stripe fires
-- customer.subscription.updated and .deleted back-to-back on a cancel — compared EQUAL and was
-- dropped as if it were a replay. Recording the applied event id lets the guard admit a DIFFERENT
-- event in the same second while still collapsing a true redelivery of the SAME one.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "lastBillingEventId" TEXT;

-- ── #26 · frozen affiliate commission window ──────────────────────────────────────────────────────
-- The window was `commissionMonths` (read LIVE off the affiliate) from the earliest COMMISSION ROW.
-- Both moved: a tenant whose first payments accrued nothing (partner suspended, 100% coupon, 0% rate)
-- anchored on a later payment and earned past the agreed term, and an admin editing commissionMonths
-- re-opened windows that had closed years of invoices ago. Anchor on the first PAYMENT and snapshot
-- the term with it.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "commissionAnchorAt"       TIMESTAMPTZ;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "commissionMonthsAtAnchor" INTEGER;

-- Backfill from the existing ledger so no live window shifts on deploy: the anchor becomes what the
-- old code computed (earliest paidAt, falling back to createdAt for rows written before paidAt
-- existed), and the term becomes the affiliate's CURRENT value — which is what the old code was
-- reading anyway. Tenants with no commission yet stay NULL and anchor on their next payment.
UPDATE "tenants" t
   SET "commissionAnchorAt"       = f.anchor,
       "commissionMonthsAtAnchor" = a."commissionMonths"
  FROM (SELECT "tenantId", MIN(COALESCE("paidAt", "createdAt")) AS anchor FROM "commissions" GROUP BY "tenantId") f,
       "affiliates" a
 WHERE t.id = f."tenantId"
   AND a.id = t."referredByAffiliateId"
   AND t."commissionAnchorAt" IS NULL;
