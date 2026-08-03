-- Partner self-service login (F5): a nullable password hash on the affiliate + a one-time
-- set/reset-password token table (mirrors password_reset_tokens for tenant users).

-- AlterTable
ALTER TABLE "affiliates" ADD COLUMN "passwordHash" TEXT;

-- CreateTable
CREATE TABLE "affiliate_password_tokens" (
    "id" UUID NOT NULL,
    "affiliateId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMPTZ,

    CONSTRAINT "affiliate_password_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_password_tokens_tokenHash_key" ON "affiliate_password_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "affiliate_password_tokens_affiliateId_idx" ON "affiliate_password_tokens"("affiliateId");

-- AddForeignKey
ALTER TABLE "affiliate_password_tokens" ADD CONSTRAINT "affiliate_password_tokens_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
