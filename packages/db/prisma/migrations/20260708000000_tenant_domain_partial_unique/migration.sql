-- E03-5 hardening (adversarial review MED): a PENDING domain squat must not block the
-- real owner from adding + verifying that domain. Move global uniqueness from all rows
-- to VERIFIED rows only. Pending rows are unique per tenant (composite); the first
-- tenant to prove DNS ownership wins the global slot.

-- drop the old global-unique-on-domain
DROP INDEX "tenant_domains_domain_key";

-- pending/duplicate domains allowed across tenants; a single tenant still can't list
-- the same domain twice
CREATE UNIQUE INDEX "tenant_domains_tenantId_domain_key" ON "tenant_domains"("tenantId", "domain");

-- at most one VERIFIED row per domain, platform-wide (partial index — Prisma can't
-- express this, so the repo's verify path maps a violation to 409)
CREATE UNIQUE INDEX "tenant_domains_verified_domain_key" ON "tenant_domains"("domain") WHERE "verified";
