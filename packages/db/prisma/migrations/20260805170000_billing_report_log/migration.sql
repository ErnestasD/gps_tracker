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
--
-- `included` is stored with the row because the allowance is a property of the plan AT THE TIME, and
-- the reporter re-walks days after the fact: a tenant that downgrades from 750 included to 200 would
-- otherwise have last week's already-billed days recomputed against the new, smaller allowance and
-- be charged hundreds of device-days it never owed.
CREATE TABLE IF NOT EXISTS "usage_reports" (
  "tenantId"   UUID        NOT NULL,
  "day"        DATE        NOT NULL,
  "reported"   INTEGER     NOT NULL,
  "included"   INTEGER,
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

-- ── #25 · same-second Stripe event ordering ───────────────────────────────────────────────────────
-- `event.created` is Unix SECONDS. The monotonic guard was `lastBillingEventAt < eventAt`, so a
-- second event genuinely emitted in the same second as the first — Stripe fires
-- customer.subscription.updated and .deleted back-to-back on a cancel — compared EQUAL and was
-- dropped as if it were a replay, leaving the tenant on the intermediate state.
--
-- Admitting equal seconds needs two things the timestamp cannot give:
--
--  * a DURABLE record of which events have been applied. A single `lastBillingEventId` column only
--    remembers the last one, so `updated → deleted → (retry of updated)` — an ordinary Stripe retry
--    after a lost response — passed the "different id" test and resurrected the canceled
--    subscription as active and entitled. `billing_events` is that record; a redelivery of ANY
--    previously applied event now collapses, however many events have landed since.
--  * a DETERMINISTIC order WITHIN the second, because Stripe does not guarantee delivery order.
--    Ranking by event type (created < updated < deleted) and admitting only `rank >= last` means
--    reverse delivery cannot undo a cancel, while two same-second `.updated`s (a plan change emits
--    exactly that) still both apply.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "lastBillingEventId"   TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "lastBillingEventRank" INTEGER;

-- Applied Stripe events, for durable redelivery suppression. Deliberately NOT keyed on the tenant:
-- the whole point is that it answers "have I already applied this event id" independently of what
-- the tenant row currently holds. Pruned by the retention sweep (Stripe retries for ~3 days; the
-- rows are kept far longer than that).
CREATE TABLE IF NOT EXISTS "billing_events" (
  "eventId"   TEXT        NOT NULL,
  "type"      TEXT        NOT NULL,
  "eventAt"   TIMESTAMPTZ NOT NULL,
  "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "billing_events_pkey" PRIMARY KEY ("eventId")
);
CREATE INDEX IF NOT EXISTS "billing_events_appliedAt_idx" ON "billing_events" ("appliedAt");

-- ── #26 · frozen affiliate commission window ──────────────────────────────────────────────────────
-- The window was `commissionMonths` (read LIVE off the affiliate) from the earliest COMMISSION ROW.
-- Both moved: a tenant whose first payments accrued nothing (partner suspended, 100% coupon, 0% rate)
-- anchored on a later payment and earned past the agreed term, and an admin editing commissionMonths
-- re-opened windows that had closed years of invoices ago. Anchor on the first PAYMENT and snapshot
-- the term with it.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "commissionAnchorAt"       TIMESTAMPTZ;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "commissionMonthsAtAnchor" INTEGER;

-- Backfill from the existing ledger so no live window shifts on deploy. The anchor is the earliest
-- NON-NULL `paidAt`, which is exactly what the old `orderBy: [{paidAt:'asc'},{createdAt:'asc'}]`
-- picked — Postgres orders NULLs LAST on ASC, so a legacy row with no `paidAt` (every commission
-- written before migration 20260804090000) never won that ordering. `MIN(COALESCE(paidAt,createdAt))`
-- would have quietly moved such a tenant's anchor WEEKS earlier and closed its window sooner than
-- the behaviour being replaced. Only when a tenant has no `paidAt` at all does createdAt stand in,
-- which is the old code's own fallback. The term becomes the affiliate's CURRENT value — which is
-- what the old code read live. Tenants with no commission yet stay NULL and anchor on their next
-- payment.
UPDATE "tenants" t
   SET "commissionAnchorAt"       = f.anchor,
       "commissionMonthsAtAnchor" = a."commissionMonths"
  FROM (
         SELECT "tenantId",
                COALESCE(MIN("paidAt"), MIN("createdAt")) AS anchor
           FROM "commissions"
          GROUP BY "tenantId"
       ) f,
       "affiliates" a
 WHERE t.id = f."tenantId"
   AND a.id = t."referredByAffiliateId"
   AND t."commissionAnchorAt" IS NULL;
