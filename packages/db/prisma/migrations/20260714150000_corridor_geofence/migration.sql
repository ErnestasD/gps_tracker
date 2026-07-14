-- Corridor geofences (V2): a buffered route line, stored as its geography(Polygon) like any fence.
-- 'exit' transition on a corridor = the vehicle left the route → the existing geofence engine fires.
ALTER TYPE "GeofenceKind" ADD VALUE IF NOT EXISTS 'corridor';
