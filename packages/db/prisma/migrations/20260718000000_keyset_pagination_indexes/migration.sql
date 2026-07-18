-- Keyset-pagination indexes (audit review MED/LOW): the events, audit_log and webhook_deliveries
-- lists all paginate `ORDER BY id DESC` under a tenant(/account) filter, but only `at`-leading
-- indexes existed — Postgres had to walk the id PK backwards discarding other tenants' rows, or
-- top-N sort a whole tenant via the `at` index. These add an index whose leading columns serve the
-- scope filter AND the id ordering. CONCURRENTLY is intentionally NOT used (Prisma wraps migrations
-- in a transaction); these tables are small/operational relative to positions.
CREATE INDEX "events_tenantId_accountId_id_idx" ON "events"("tenantId", "accountId", "id");
CREATE INDEX "audit_log_tenantId_id_idx" ON "audit_log"("tenantId", "id");
CREATE INDEX "webhook_deliveries_tenantId_accountId_id_idx" ON "webhook_deliveries"("tenantId", "accountId", "id");
