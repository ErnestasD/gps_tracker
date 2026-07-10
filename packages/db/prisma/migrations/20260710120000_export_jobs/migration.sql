-- GDPR account export jobs (E08-4)
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "path" TEXT,
    "sizeBytes" BIGINT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "export_jobs_tenantId_createdAt_idx" ON "export_jobs"("tenantId", "createdAt");
