-- Temporary public share links (V1-nice) — expiring, revocable single-device live URLs.
-- Token stored as SHA-256 hash (never plaintext); expiry + revoke enforced at resolve time.
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "deviceId" BIGINT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "label" TEXT,
    "createdByUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "share_links_tokenHash_key" ON "share_links"("tokenHash");
CREATE INDEX "share_links_tenantId_idx" ON "share_links"("tenantId");
CREATE INDEX "share_links_deviceId_idx" ON "share_links"("deviceId");

-- Retiring/erasing a device kills its share links (no dangling public URLs).
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
