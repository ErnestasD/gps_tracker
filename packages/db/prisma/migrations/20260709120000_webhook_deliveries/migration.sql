-- E06-4b: webhook delivery log (one row per POST attempt, read-only over the API)
CREATE TABLE "webhook_deliveries" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID,
    "webhookId" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "statusCode" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_deliveries_tenantId_at_idx" ON "webhook_deliveries"("tenantId", "at");
CREATE INDEX "webhook_deliveries_webhookId_at_idx" ON "webhook_deliveries"("webhookId", "at");
