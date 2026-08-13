-- api_keys carried a tenantId with no foreign key, so deleting a tenant left its keys behind. A
-- request with such a key resolved as ACTIVE and then threw in the entitlement lookup — a 500 on
-- every call instead of a clean 401 — and no cleanup path could see the rows (audit C16).
--
-- Orphans must go before the constraint can be trusted; there is no tenant left to attribute them
-- to, and a key whose tenant is gone can never be legitimately used again.
DELETE FROM "api_keys" k WHERE NOT EXISTS (SELECT 1 FROM "tenants" t WHERE t.id = k."tenantId");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
