import type { NormalizedRecord } from '@orbetra/shared'

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

const EARTH_R_M = 6_371_000

/** Haversine in metres (§6.4 fallback distance source when no odometer). */
export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(s))
}

/**
 * STUB until E04-1 (story-sanctioned, E02-7 AC): per-device haversine distance
 * accumulator standing in for the trip engine's distance feed. Exists so I5 has a
 * concrete thing to protect and a test to prove it. E04-1 replaces this with the
 * real trip state machine (which also prefers Δodometer, §6.4).
 */
export class TripDistanceStub {
  private readonly lastPoint = new Map<string, { lat: number; lon: number }>()
  readonly totalM = new Map<string, number>()

  feed(records: NormalizedRecord[]): void {
    for (const rec of records) {
      const key = rec.deviceId.toString()
      const prev = this.lastPoint.get(key)
      if (prev) {
        const total = (this.totalM.get(key) ?? 0) + haversineM(prev.lat, prev.lon, rec.lat, rec.lon)
        this.totalM.set(key, total)
      }
      this.lastPoint.set(key, { lat: rec.lat, lon: rec.lon })
    }
  }
}

/** STUB until E05-x: the geofence evaluator's input queue. */
export class GeofenceQueueStub {
  readonly queue: NormalizedRecord[] = []

  feed(records: NormalizedRecord[]): void {
    this.queue.push(...records)
  }
}

/** Batch fan-out to all motion consumers, behind the I5 filter. */
export class MotionFeed {
  constructor(
    readonly tripDistance = new TripDistanceStub(),
    readonly geofenceQueue = new GeofenceQueueStub(),
  ) {}

  feed(records: NormalizedRecord[]): void {
    const valid = motionRecords(records)
    if (valid.length === 0) return
    this.tripDistance.feed(valid)
    this.geofenceQueue.feed(valid)
  }
}
