-- Pilot-request leads from the public site (W9-S1)
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "deviceCount" TEXT,
    "message" TEXT,
    "ref" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leads_createdAt_idx" ON "leads"("createdAt");
