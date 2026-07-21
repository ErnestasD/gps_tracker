-- SMS gateway (founder decision 2026-07-21). Append-only (rule 11).
-- Platform-default Twilio only in V1 (no per-tenant creds table). Adds SIM identity to devices
-- (msisdn = the number config SMS are sent TO; iccid = informational) and an sms_deliveries audit
-- table the worker drives queued→sent|failed.

CREATE TYPE "SmsStatus" AS ENUM (
  'queued',
  'sent',
  'failed'
);

ALTER TABLE "devices" ADD COLUMN "simMsisdn" TEXT;
ALTER TABLE "devices" ADD COLUMN "simIccid" TEXT;

CREATE TABLE "sms_deliveries" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"          UUID NOT NULL,
  "accountId"         UUID NOT NULL,
  "deviceId"          BIGINT NOT NULL,
  "to"                TEXT NOT NULL,
  "body"              TEXT NOT NULL,
  "provider"          TEXT NOT NULL DEFAULT 'twilio',
  "providerMessageId" TEXT,
  "status"            "SmsStatus" NOT NULL DEFAULT 'queued',
  "error"             TEXT,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "sentAt"            TIMESTAMPTZ,
  CONSTRAINT "sms_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sms_deliveries_deviceId_status_idx" ON "sms_deliveries" ("deviceId", "status");
CREATE INDEX "sms_deliveries_tenantId_accountId_createdAt_idx" ON "sms_deliveries" ("tenantId", "accountId", "createdAt");
