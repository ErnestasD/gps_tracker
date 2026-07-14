-- Monotonic guard for out-of-order/duplicate Stripe webhooks (ADR-024). We store the timestamp of
-- the last applied billing event; a subscription update is applied ONLY when the incoming event is
-- strictly newer, so a reordered stale 'active' can never resurrect a 'canceled' subscription, and
-- concurrent duplicate deliveries collapse atomically (the WHERE loses on the second).
ALTER TABLE "tenants" ADD COLUMN "lastBillingEventAt" TIMESTAMPTZ;
