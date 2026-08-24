-- Tenant-level web-push subscriptions (audit fix, "pranešimai neveikia").
-- A tenant-wide admin has no accountId in the JWT, so /v1/push/subscribe 400'd for exactly
-- the people who run the fleet. accountId becomes nullable: NULL = a tenant-level
-- subscription that receives every account's webpush fan-out in that tenant.
ALTER TABLE "push_subscriptions" ALTER COLUMN "accountId" DROP NOT NULL;
