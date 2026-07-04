-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('platform_admin', 'tsp_admin', 'account_manager', 'viewer');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('queued', 'sent', 'acked', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "GeofenceKind" AS ENUM ('polygon', 'circle');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('geofence', 'overspeed', 'ignition', 'din_change', 'power_cut', 'low_battery', 'panic', 'device_offline');

-- CreateEnum
CREATE TYPE "OdometerSource" AS ENUM ('auto', 'device', 'gps');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "referredByAffiliateId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domains" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "txtToken" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_profiles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "presenceRules" JSONB NOT NULL DEFAULT '{}',
    "commandPresets" JSONB NOT NULL DEFAULT '[]',
    "readIdleMin" INTEGER NOT NULL DEFAULT 40,

    CONSTRAINT "device_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "imei" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT,
    "groupName" TEXT,
    "odometerSource" "OdometerSource" NOT NULL DEFAULT 'auto',
    "retiredAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_rejects" (
    "id" BIGSERIAL NOT NULL,
    "imei" TEXT,
    "reason" TEXT NOT NULL,
    "payload" BYTEA,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_rejects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "deviceId" BIGINT NOT NULL,
    "status" "TripStatus" NOT NULL,
    "startTime" TIMESTAMPTZ NOT NULL,
    "endTime" TIMESTAMPTZ,
    "startLat" DOUBLE PRECISION,
    "startLon" DOUBLE PRECISION,
    "endLat" DOUBLE PRECISION,
    "endLon" DOUBLE PRECISION,
    "distanceM" INTEGER NOT NULL DEFAULT 0,
    "distanceSource" TEXT NOT NULL DEFAULT 'gps',
    "maxSpeed" INTEGER NOT NULL DEFAULT 0,
    "idleS" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#4DA3FF',
    "kind" "GeofenceKind" NOT NULL,
    "geom" geography(Polygon,4326) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "scope" JSONB NOT NULL DEFAULT '{}',
    "channels" JSONB NOT NULL DEFAULT '[]',
    "cooldownS" INTEGER NOT NULL DEFAULT 300,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "deviceId" BIGINT NOT NULL,
    "ruleId" UUID,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "acknowledgedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commands" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "deviceId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'queued',
    "response" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "lastUsedAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_daily" (
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "deviceId" BIGINT NOT NULL,
    "day" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usage_daily_pkey" PRIMARY KEY ("deviceId","day")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geocode_cache" (
    "gridKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "resolvedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("gridKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domains_domain_key" ON "tenant_domains"("domain");

-- CreateIndex
CREATE INDEX "tenant_domains_tenantId_idx" ON "tenant_domains"("tenantId");

-- CreateIndex
CREATE INDEX "accounts_tenantId_idx" ON "accounts"("tenantId");

-- CreateIndex
CREATE INDEX "users_accountId_idx" ON "users"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "device_profiles_key_key" ON "device_profiles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "devices_imei_key" ON "devices"("imei");

-- CreateIndex
CREATE INDEX "devices_tenantId_accountId_idx" ON "devices"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "raw_rejects_createdAt_idx" ON "raw_rejects"("createdAt");

-- CreateIndex
CREATE INDEX "trips_deviceId_startTime_idx" ON "trips"("deviceId", "startTime");

-- CreateIndex
CREATE INDEX "trips_tenantId_accountId_startTime_idx" ON "trips"("tenantId", "accountId", "startTime");

-- CreateIndex
CREATE INDEX "geofences_tenantId_accountId_idx" ON "geofences"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "rules_tenantId_accountId_enabled_idx" ON "rules"("tenantId", "accountId", "enabled");

-- CreateIndex
CREATE INDEX "events_tenantId_accountId_at_idx" ON "events"("tenantId", "accountId", "at");

-- CreateIndex
CREATE INDEX "events_deviceId_at_idx" ON "events"("deviceId", "at");

-- CreateIndex
CREATE INDEX "commands_deviceId_status_idx" ON "commands"("deviceId", "status");

-- CreateIndex
CREATE INDEX "commands_tenantId_accountId_createdAt_idx" ON "commands"("tenantId", "accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys"("hash");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_idx" ON "api_keys"("tenantId");

-- CreateIndex
CREATE INDEX "webhooks_tenantId_enabled_idx" ON "webhooks"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "usage_daily_tenantId_day_idx" ON "usage_daily"("tenantId", "day");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_at_idx" ON "audit_log"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "device_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

