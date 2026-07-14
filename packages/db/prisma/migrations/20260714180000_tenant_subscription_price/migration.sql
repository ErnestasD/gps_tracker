-- The subscribed BASE price id (which plan), so the usage reporter knows a tenant's plan → included
-- device count and whether it carries metered overage (TSP only). Written by the webhook. (ADR-024, PR B2)
ALTER TABLE "tenants" ADD COLUMN "subscriptionPriceId" TEXT;
