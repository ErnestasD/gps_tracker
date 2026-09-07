-- The address a white-label tenant's mail goes out AS (ADR-036, audit W-3).
--
-- `tenantId` is UNIQUE: a reseller sends as one identity. That makes "the tenant's sending address" a
-- total function for the send path, which has no sensible way to choose between two, and matches
-- Navixy — the closest comparable product — which allows exactly one.
--
-- ── Why `domain` is unique among VERIFIED rows, and why there is a txtToken ──────────────────────
-- SES verification proves that a DOMAIN published our DKIM records. It says NOTHING about who asked.
-- Without both of the guards below, tenant B could name a domain tenant A had already verified, read
-- back the identity SES already holds, and start sending DKIM-signed, DMARC-aligned mail as somebody
-- else's company — authenticated spoofing to any address, since rule channels and scheduled-report
-- recipients are free-text. The mirror image is just as bad: B deleting that row would tear down the
-- shared SES identity and silently stop A's mail.
--
-- So ownership is proved the way it already is for app domains (`tenant_domains`): a CSPRNG token at
-- `_orbetra-verify.<domain>`, published by whoever controls the zone. The partial unique index is the
-- second half — the same shape as `tenant_domains_domain_verified_key` — so that even with a proof
-- bug, two tenants cannot both hold a verified claim on one domain. First to prove it wins.
--
-- No foreign key to `tenant_domains`. Serving the app at `fleet.klientas.lt` and sending from
-- `klientas.lt` are different names proved by different records, and coupling them would force a
-- tenant to add a domain they do not host on.
CREATE TABLE "tenant_sending_domains" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenantId"    UUID         NOT NULL,
    "domain"      TEXT         NOT NULL,
    "mailbox"     TEXT         NOT NULL,
    "status"      TEXT         NOT NULL DEFAULT 'pending',
    -- ownership proof for THIS tenant over THIS domain, published as `_orbetra-verify.<domain>` TXT
    "txtToken"    TEXT         NOT NULL,
    "dkimTokens"  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sesIdentity" TEXT,
    "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- NULL until BOTH proofs hold: our ownership TXT resolves, and SES reports DKIM success. The send
    -- path reads this, not `status`: a row that is pending, failed, or mid-edit must fall back to the
    -- platform identity rather than send as a domain that has not authorised us, which would fail
    -- DMARC and put a customer's alerts in spam.
    "verifiedAt"  TIMESTAMPTZ,

    CONSTRAINT "tenant_sending_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_sending_domains_tenantId_key" ON "tenant_sending_domains"("tenantId");

-- Global exclusivity applies ONLY to verified rows, exactly as it does for app domains: an unverified
-- row is a claim nobody has proved, and letting a squatter's pending row block the real owner would
-- be worse than allowing two pending claims that can never both succeed.
CREATE UNIQUE INDEX "tenant_sending_domains_domain_verified_key"
    ON "tenant_sending_domains"("domain") WHERE "verifiedAt" IS NOT NULL;

ALTER TABLE "tenant_sending_domains"
    ADD CONSTRAINT "tenant_sending_domains_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
