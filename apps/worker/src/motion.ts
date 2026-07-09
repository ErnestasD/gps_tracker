import type { NormalizedRecord } from '@orbetra/shared'

import { GeofenceEngine, type GeofenceDef, type GeofenceTransition } from './geofence/engine.js'
import { TripEngine, type DeviceTripConfig, type TripEvent } from './trip/engine.js'

export { haversineM } from './geo.js'

/**
 * The I5 seam (E02-7, PROJECT_PLAN §6.1): the ONE chokepoint through which records
 * flow to MOTION consumers — trip engine (E04-1), geofence/rules evaluation (E05-x),
 * overspeed. Invalid fixes (satellites==0 ⇒ fixValid=false carry the device's LAST
 * VALID coordinates, §3.4) are filtered HERE, so no future motion consumer can
 * accidentally receive one. The presence path (LiveState) deliberately does NOT go
 * through this seam — invalid fixes may affect presence and IO events.
 */
export function motionRecords(records: NormalizedRecord[]): NormalizedRecord[] {
  return records.filter((r) => r.fixValid) // I5
}

export interface MotionResult {
  tripEvents: TripEvent[]
  transitions: GeofenceTransition[]
}

/** Batch fan-out to all motion consumers, behind the I5 filter. Records are filtered to
 * fix_valid ONCE and shared by both engines (E04-1 trips + E05-2 geofences). */
export class MotionFeed {
  constructor(
    readonly tripEngine = new TripEngine(),
    readonly geofenceEngine = new GeofenceEngine(),
  ) {}

  /** `configFor` = per-device trip thresholds/odometerSource (E04-5); `geofencesFor` =
   * the device's applicable geofences (E05-2), both pre-resolved by the worker. */
  feed(
    records: NormalizedRecord[],
    configFor?: (deviceId: bigint) => DeviceTripConfig | undefined,
    geofencesFor?: (deviceId: bigint) => readonly GeofenceDef[],
    insideFor?: (deviceId: bigint, geofenceId: string) => boolean,
  ): MotionResult {
    const valid = motionRecords(records)
    if (valid.length === 0) return { tripEvents: [], transitions: [] }
    return {
      tripEvents: this.tripEngine.feed(valid, configFor),
      transitions: geofencesFor ? this.geofenceEngine.feed(valid, geofencesFor, insideFor) : [],
    }
  }
}
