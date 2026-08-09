-- Performance tier: "20% base, 25% once you have 10 paying customers".
--
-- The cheapest motivator in the programme, and safe to add because the rate is already snapshotted
-- on every commission (§6.9) — crossing a threshold changes what is earned from then on and never
-- re-prices a single line of history. Both columns null ⇒ a flat rate, which is every existing
-- partner, so this is inert until someone sets it.
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "tierPct" DECIMAL(5,2);
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "tierMinCustomers" INTEGER;
