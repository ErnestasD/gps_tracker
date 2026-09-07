-- The address a white-label tenant's mail goes out AS (ADR-036, audit W-3).
--
-- `tenantId` is UNIQUE, not merely indexed: a reseller sends as one identity. That makes "the
-- tenant's sending address" a total function for the send path, which has no sensible way to choose
-- between two, and matches Navixy — the closest comparable product — which allows exactly one.
--
-- No foreign key to `tenant_domains`. Serving the app at `fleet.klientas.lt` and sending from
-- `klientas.lt` are different names proved by different records (a CNAME to our edge versus three
-- DKIM CNAMEs); coupling them would force a tenant to add a domain they do not host on.
CREATE TABLE "tenant_sending_domains" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"    UUID         NOT NULL,
    "domain"      TEXT         NOT NULL,
    "mailbox"     TEXT         NOT NULL,
    "status"      TEXT         NOT NULL DEFAULT 'pending',
    "dkimTokens"  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sesIdentity" TEXT,
    "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- NULL until SES reports SUCCESS. The send path reads this, not `status`: a row that is pending,
    -- failed, or mid-edit must fall back to the platform identity rather than send as a domain that
    -- has not authorised us, which would fail DMARC and land the customer's alerts in spam.
    "verifiedAt"  TIMESTAMPTZ,

    CONSTRAINT "tenant_sending_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_sending_domains_tenantId_key" ON "tenant_sending_domains"("tenantId");

ALTER TABLE "tenant_sending_domains"
    ADD CONSTRAINT "tenant_sending_domains_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
