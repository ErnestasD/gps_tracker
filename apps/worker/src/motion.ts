import type { NormalizedRecord } from '@orbetra/shared'

import { TripEngine, type TripEvent } from './trip/engine.js'

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

/**
 * STUB until E05-x: the geofence evaluator's input queue. CAPPED ring — nothing
 * consumes it yet, and an uncapped array in the long-lived worker is the §10
 * unbounded-buffer failure (review HIGH: it would grow with every valid record
 * until OOM, killing the shard leases with it). E05-x replaces this with a real
 * consumer; until then old entries are dropped, counted, never awaited.
 */
export class GeofenceQueueStub {
  static readonly CAP = 10_000
  readonly queue: NormalizedRecord[] = []
  dropped = 0

  feed(records: NormalizedRecord[]): void {
    this.queue.push(...records)
    const excess = this.queue.length - GeofenceQueueStub.CAP
    if (excess > 0) {
      this.queue.splice(0, excess)
      this.dropped += excess
    }
  }
}

/** Batch fan-out to all motion consumers, behind the I5 filter. */
export class MotionFeed {
  constructor(
    readonly tripEngine = new TripEngine(),
    readonly geofenceQueue = new GeofenceQueueStub(),
  ) {}

  /** Feed a batch; returns the trip open/close events for the worker to persist. */
  feed(records: NormalizedRecord[]): TripEvent[] {
    const valid = motionRecords(records)
    if (valid.length === 0) return []
    this.geofenceQueue.feed(valid)
    return this.tripEngine.feed(valid) // I5-filtered input only
  }
}
