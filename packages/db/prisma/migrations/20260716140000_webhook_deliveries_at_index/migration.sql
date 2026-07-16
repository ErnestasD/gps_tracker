-- Retention prune (WHERE at < cutoff) had no supporting index: only (tenantId, at) and
-- (webhookId, at) exist, both leading with a column the prune does not constrain → seq-scan.
-- A bare btree on `at` lets the daily sweep seek. IF NOT EXISTS keeps re-applies safe.
CREATE INDEX IF NOT EXISTS "webhook_deliveries_at_idx" ON "webhook_deliveries"("at");
