-- Driver on a trip (V2). Nullable; SET NULL on driver delete so trip history survives.
ALTER TABLE "trips" ADD COLUMN "driverId" UUID;

CREATE INDEX "trips_driverId_idx" ON "trips"("driverId");

ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
