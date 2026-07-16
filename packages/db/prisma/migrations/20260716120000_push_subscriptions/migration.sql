-- Browser push subscriptions (Web Push, ADR-026).
CREATE TABLE "push_subscriptions" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"  UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "userId"    UUID NOT NULL,
  "endpoint"  TEXT NOT NULL,
  "p256dh"    TEXT NOT NULL,
  "auth"      TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" ("endpoint");
CREATE INDEX "push_subscriptions_tenantId_accountId_idx" ON "push_subscriptions" ("tenantId", "accountId");
