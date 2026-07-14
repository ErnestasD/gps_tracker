-- Stripe billing state on tenants (ADR-024). All nullable; subscription fields are written
-- ONLY by the signature-verified Stripe webhook. stripeCustomerId is unique when present.
ALTER TABLE "tenants" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "subscriptionStatus" TEXT;
ALTER TABLE "tenants" ADD COLUMN "currentPeriodEnd" TIMESTAMPTZ;

-- one Stripe customer ↔ one tenant; the webhook resolves a tenant by this id
CREATE UNIQUE INDEX "tenants_stripeCustomerId_key" ON "tenants" ("stripeCustomerId");
