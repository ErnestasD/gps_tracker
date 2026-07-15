-- Scheduled emailed reports (V1-nice). The worker's hourly cron runs + e-mails these.
CREATE TABLE "scheduled_reports" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"   UUID NOT NULL,
  "accountId"  UUID NOT NULL,
  "reportType" TEXT NOT NULL,
  "cadence"    TEXT NOT NULL,
  "hourUtc"    INTEGER NOT NULL,
  "weekday"    INTEGER,
  "recipients" TEXT[] NOT NULL DEFAULT '{}',
  "timezone"   TEXT NOT NULL DEFAULT 'UTC',
  "enabled"    BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt"  TIMESTAMPTZ,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "scheduled_reports_enabled_idx" ON "scheduled_reports" ("enabled");
