-- Driver registry (V2). Account-scoped; iButton/RFID key id unique within a tenant.
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "licenseNo" TEXT,
    "ibutton" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "drivers_tenantId_accountId_idx" ON "drivers"("tenantId", "accountId");
-- iButton unique per tenant (NULLs are distinct → many keyless drivers allowed)
CREATE UNIQUE INDEX "drivers_tenantId_ibutton_key" ON "drivers"("tenantId", "ibutton");
