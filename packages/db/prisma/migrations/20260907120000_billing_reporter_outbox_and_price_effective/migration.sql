-- audit F1 (outbox): a meter submission is written PENDING before the Stripe call and confirmed
-- after, so a submit that succeeds while its confirming write fails is re-driven with the SAME
-- identifier rather than re-billed under a new one when the day's usage grows.
ALTER TABLE "usage_reports" ADD COLUMN "pendingTarget" INTEGER;
ALTER TABLE "usage_reports" ADD COLUMN "pendingIdentifier" TEXT;

-- audit F2: the instant the current base price took effect, so the reporter can freeze a no-row day
-- that predates a plan change instead of recomputing it against the new allowance.
ALTER TABLE "tenants" ADD COLUMN "subscriptionPriceEffectiveAt" TIMESTAMPTZ;

-- BACKFILL (audit F1/F2 fix-review R1): the F2 freeze is gated on subscriptionPriceEffectiveAt !== null.
-- Left NULL, every pre-existing subscriber would get ZERO F2 protection, re-opening the exact
-- downgrade over-bill F2 prevents: a plan change made BEFORE this deploy leaves a no-row window day
-- recomputed against the new (smaller) allowance. We cannot tell "never changed price" from "changed
-- pre-migration" after the fact, so we choose the NEVER-OVER-BILL direction: stamp every subscribed
-- tenant's effective-start at deploy time. A no-row day BEFORE deploy is then FROZEN (a bounded,
-- alerted possible lost-revenue freeze over the reporter's trailing window) instead of a silent
-- over-charge; days after deploy bill normally against the current price. Over-billing a customer
-- money they do not owe is the worse failure, so the freeze wins.
UPDATE "tenants" SET "subscriptionPriceEffectiveAt" = now()
  WHERE "subscriptionPriceId" IS NOT NULL AND "subscriptionPriceEffectiveAt" IS NULL;
