-- FLEET-1 (docs/epics/FLEET-1.md): vehicle profile on devices, engine-hour intervals,
-- service log, vehicle documents, maintenance plan templates.

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('petrol', 'diesel', 'electric', 'hybrid', 'lpg', 'cng', 'other');
CREATE TYPE "VehicleStatus" AS ENUM ('active', 'in_service', 'reserve');
CREATE TYPE "VehicleDocumentKind" AS ENUM ('insurance', 'inspection', 'tachograph', 'permit', 'leasing', 'other');

-- AlterTable: vehicle profile on devices (FLEET-1 F1)
ALTER TABLE "devices"
  ADD COLUMN "make" TEXT,
  ADD COLUMN "vehicleModel" TEXT,
  ADD COLUMN "year" INTEGER,
  ADD COLUMN "vin" TEXT,
  ADD COLUMN "fuelType" "FuelType",
  ADD COLUMN "vehicleStatus" "VehicleStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "purchaseDate" DATE,
  ADD COLUMN "purchasePriceCents" INTEGER,
  ADD COLUMN "driverId" UUID;

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: engine-hour intervals (FLEET-1 F2)
ALTER TABLE "maintenance_items"
  ADD COLUMN "intervalEngineH" INTEGER,
  ADD COLUMN "lastServiceEngineH" INTEGER;

-- CreateTable: service log (FLEET-1 F2)
CREATE TABLE "service_log_entries" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "deviceId" BIGINT NOT NULL,
  "maintenanceItemId" UUID,
  "title" TEXT NOT NULL,
  "at" TIMESTAMPTZ NOT NULL,
  "odoKm" INTEGER,
  "engineH" INTEGER,
  "costCents" INTEGER,
  "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
  "vendor" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_log_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_log_entries_tenantId_accountId_idx" ON "service_log_entries"("tenantId", "accountId");
CREATE INDEX "service_log_entries_deviceId_at_idx" ON "service_log_entries"("deviceId", "at");
ALTER TABLE "service_log_entries"
  ADD CONSTRAINT "service_log_entries_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: vehicle documents (FLEET-1 F3)
CREATE TABLE "vehicle_documents" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "deviceId" BIGINT NOT NULL,
  "kind" "VehicleDocumentKind" NOT NULL,
  "title" TEXT NOT NULL,
  "number" TEXT,
  "validFrom" DATE,
  "validTo" DATE NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vehicle_documents_tenantId_accountId_idx" ON "vehicle_documents"("tenantId", "accountId");
CREATE INDEX "vehicle_documents_tenantId_validTo_idx" ON "vehicle_documents"("tenantId", "validTo");
CREATE INDEX "vehicle_documents_deviceId_idx" ON "vehicle_documents"("deviceId");
ALTER TABLE "vehicle_documents"
  ADD CONSTRAINT "vehicle_documents_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: maintenance plan templates (FLEET-1 F2)
CREATE TABLE "maintenance_plans" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "accountId" UUID,
  "name" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "maintenance_plans_tenantId_idx" ON "maintenance_plans"("tenantId");
