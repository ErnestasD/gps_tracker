-- Affiliate/partner program (W9). affiliates + commissions tables; the tenants.referredByAffiliateId
-- column already exists (0_init, anticipated) — this only adds its FK to the new affiliates table.

-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('pending', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('pending', 'paid', 'void');

-- CreateTable
CREATE TABLE "affiliates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "commissionMonths" INTEGER NOT NULL DEFAULT 12,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "affiliateId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "sourceInvoiceId" TEXT NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_email_key" ON "affiliates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_code_key" ON "affiliates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_sourceInvoiceId_key" ON "commissions"("sourceInvoiceId");

-- CreateIndex
CREATE INDEX "commissions_affiliateId_status_idx" ON "commissions"("affiliateId", "status");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_referredByAffiliateId_fkey" FOREIGN KEY ("referredByAffiliateId") REFERENCES "affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
