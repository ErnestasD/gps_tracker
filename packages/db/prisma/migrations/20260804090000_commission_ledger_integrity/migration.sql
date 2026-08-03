-- Commission is a FINANCIAL LEDGER — it must survive the deletion of the rows it references, and it
-- must record the terms that were actually agreed (audit HIGH-1 + MED).
--
-- 1) Both FKs were ON DELETE CASCADE, so `DELETE /v1/tenants/:id` silently destroyed every commission
--    for that tenant — including `paid` rows (money already transferred) and `pending` rows (money
--    owed). The audit trail kept only the tenant row, so payouts could not be reconciled afterwards.
--    RESTRICT makes the ledger authoritative: a tenant/affiliate carrying commissions cannot be hard
--    deleted, and the API turns the resulting FK violation into a 409 (mirrors the accounts-with-users
--    guard). Note tenants.referredByAffiliateId stays ON DELETE SET NULL — dropping an attribution is
--    fine, dropping the money record is not.
ALTER TABLE "commissions" DROP CONSTRAINT "commissions_affiliateId_fkey";
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_affiliateId_fkey"
  FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commissions" DROP CONSTRAINT "commissions_tenantId_fkey";
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Terms were read LIVE from the affiliate at payout time, so editing commissionPct/commissionMonths
--    re-priced history and could reopen an already-closed earning window (PROJECT_PLAN §6.9 mandates
--    per-entry terms). Snapshot the rate and the payment the commission was computed from, and pin the
--    instant the earning window is anchored on (the tenant's FIRST real payment — previously inferred
--    from the earliest commission row's INSERT time, a different clock that drifted with webhook lag).
--    Nullable + backfilled from the live affiliate so existing rows stay readable.
ALTER TABLE "commissions" ADD COLUMN "ratePct" DECIMAL(5,2);
ALTER TABLE "commissions" ADD COLUMN "baseAmountCents" INTEGER;
ALTER TABLE "commissions" ADD COLUMN "paidAt" TIMESTAMPTZ;

UPDATE "commissions" c
SET "ratePct" = a."commissionPct",
    "baseAmountCents" = ROUND(c."amountCents" * 100.0 / NULLIF(a."commissionPct", 0))::int,
    "paidAt" = c."createdAt"
FROM "affiliates" a
WHERE a."id" = c."affiliateId" AND c."ratePct" IS NULL;
