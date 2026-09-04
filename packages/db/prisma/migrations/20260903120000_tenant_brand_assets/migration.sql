-- White-label brand images, uploaded rather than linked.
--
-- Until now a reseller had exactly one image field, "Logo URL", and it had to be a URL they hosted
-- themselves. That field did four jobs at once — sidebar, sign-in page, email header and the browser
-- tab icon — and the setup guide ended up asking the same file to be a wide 200x50 wordmark AND a
-- square mark legible at 16px. No file is both, so every tenant was quietly compromising on one of
-- them. Branding gains a second key, faviconUrl, and both keys may now point at a row here.
--
-- Why the bytes live in Postgres and not in object storage: the whole promise of white-label is that
-- a reseller's customer never learns our name, and every bucket must be reachable at SOME hostname.
-- R2 would give us pub-<id>.r2.dev or assets.orbetra.com, and both appear in the customer's browser
-- and in every email. A per-tenant bucket domain would need their DNS inside our Cloudflare account,
-- which is not something a customer's domain can be. Served from the API instead, the image is
-- reachable at the tenant's OWN domain, because Caddy already proxies /v1/* there. The stored
-- branding value is a relative path, so one string is correct on every host.
--
-- The scale this is sized for: two rows per tenant, capped at 512 KB each by the API. A favicon is
-- single-digit KB. If that ever changes, the serving route is a stable facade and the bytes can move
-- behind it without any customer-visible URL changing.
CREATE TABLE "tenant_assets" (
    "tenantId" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    -- Composite PK, so "at most one logo and one favicon per tenant" is a property of the table
    -- rather than a rule some handler remembers to enforce. It also makes the upload an UPSERT with
    -- no read-then-write race: replacing an image cannot leave two.
    CONSTRAINT "tenant_assets_pkey" PRIMARY KEY ("tenantId", "slot")
);

-- The public serving route resolves an asset by content hash ALONE. It has no tenant context on
-- purpose — that is precisely what lets one relative path render correctly on a custom domain, on
-- <slug>.orbetra.com and in the dashboard. So this is the lookup on every image request, not a
-- reporting convenience.
CREATE INDEX "tenant_assets_sha256_idx" ON "tenant_assets"("sha256");

ALTER TABLE "tenant_assets" ADD CONSTRAINT "tenant_assets_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
