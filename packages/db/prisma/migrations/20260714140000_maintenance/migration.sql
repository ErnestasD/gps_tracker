-- Maintenance schedule items (V2). Per-device service reminders by km and/or days.
CREATE TABLE "maintenance_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "deviceId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "intervalKm" INTEGER,
    "intervalDays" INTEGER,
    "lastServiceOdoKm" INTEGER,
    "lastServiceAt" TIMESTAMPTZ,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "maintenance_items_tenantId_accountId_idx" ON "maintenance_items"("tenantId", "accountId");
CREATE INDEX "maintenance_items_deviceId_idx" ON "maintenance_items"("deviceId");

-- erasing/retiring a device removes its maintenance items (no dangling reminders)
ALTER TABLE "maintenance_items" ADD CONSTRAINT "maintenance_items_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
