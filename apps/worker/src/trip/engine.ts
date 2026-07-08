import type { NormalizedRecord } from '@orbetra/shared'

import { haversineM } from '../geo.js'

/**
 * Trip state machine (E04-1, PROJECT_PLAN §6.4). PURE + deterministic: driven by
 * record `fixTime` (never wall-clock) so a replay of the same records yields the
 * same trips. Input MUST be fix_valid records (caller filters via motionRecords —
 * I5: invalid fixes never mutate trip distance/state) fed in fixTime order per
 * device. Emits open/close events; the worker persists them (no DB/Redis here).
 *
 * Thresholds come from device_profiles.presence_rules; E04-1 uses DEFAULT_THRESHOLDS
 * for every device — per-device profile selection (incl. asset/noIgnition trackers)
 * lands in E04-5 (odometer preference + per-device config). // TODO(E04-5)
 */
export interface TripThresholds {
  /** km/h above which the device counts as moving. */
  moveSpeedKmh: number
  /** seconds the moving condition must hold to open a trip… */
  movingSustainS: number
  /** …OR metres of displacement accumulated while moving (whichever first). */
  movingDisplaceM: number
  /** ignition profile: seconds of ignition=0 to close a trip. */
  parkedIgnitionOffS: number
  /** km/h below which (ignition on) counts as idle. */
  idleSpeedKmh: number
  /** seconds of sustained idle before it accrues to idleS. */
  idleSustainS: number
  /** asset trackers with no ignition wire: use speed/displacement, not ignition. */
  noIgnition: boolean
  /** noIgnition: per-step displacement below this counts as stopped. */
  parkedDisplaceM: number
  /** noIgnition: seconds of sustained stop to close a trip. */
  parkedStopS: number
}

export const DEFAULT_THRESHOLDS: TripThresholds = {
  moveSpeedKmh: 6,
  movingSustainS: 90,
  movingDisplaceM: 300,
  parkedIgnitionOffS: 180,
  idleSpeedKmh: 3,
  idleSustainS: 120,
  noIgnition: false,
  parkedDisplaceM: 100,
  parkedStopS: 300,
}

export interface OpenEvent {
  type: 'open'
  deviceId: bigint
  startTime: Date
  startLat: number
  startLon: number
}
export interface CloseEvent {
  type: 'close'
  deviceId: bigint
  startTime: Date
  endTime: Date
  startLat: number
  startLon: number
  endLat: number
  endLon: number
  distanceM: number
  distanceSource: 'gps' | 'odometer'
  maxSpeed: number
  idleS: number
}
export type TripEvent = OpenEvent | CloseEvent

const secs = (a: Date, b: Date): number => (a.getTime() - b.getTime()) / 1000

interface Candidate {
  startTime: Date
  startLat: number
  startLon: number
  startOdo: bigint | null
  lastLat: number
  lastLon: number
  dispM: number
  maxSpeed: number
}

interface OpenTrip {
  startTime: Date
  startLat: number
  startLon: number
  lastLat: number
  lastLon: number
  lastTime: Date
  haversineM: number
  odoStart: bigint | null
  odoLast: bigint | null
  odoBroken: boolean
  maxSpeed: number
  idleS: number
  idleSince: Date | null
  stopSince: Date | null
}

interface DeviceState {
  phase: 'parked' | 'moving'
  cand: Candidate | null
  trip: OpenTrip | null
  /** newest fixTime applied — drops out-of-order records in ANY phase (I2 intent). */
  lastSeen: Date | null
}

export class TripEngine {
  private readonly state = new Map<string, DeviceState>() // bounded by device count
  // devices that saw an out-of-order (late) record since the last drain, with the
  // EARLIEST late fixTime — the streaming engine drops these, so a recompute from
  // durable positions must reconcile that region (E04-2). Bounded by device count.
  private readonly late = new Map<string, Date>()

  constructor(private readonly thresholds: TripThresholds = DEFAULT_THRESHOLDS) {}

  /** Feed fix_valid, fixTime-sorted records. Returns open/close events, in order. */
  feed(records: NormalizedRecord[]): TripEvent[] {
    const out: TripEvent[] = []
    for (const r of records) this.step(r, out)
    return out
  }

  /** Drain the devices that saw a late (dropped) record and the earliest late time,
   * so the caller can enqueue a trip-recompute for each. Clears the set. */
  takeLate(): Array<{ deviceId: bigint; from: Date }> {
    const out = [...this.late].map(([id, from]) => ({ deviceId: BigInt(id), from }))
    this.late.clear()
    return out
  }

  /** True while a device has an unclosed trip (used by the worker to persist open rows). */
  hasOpenTrip(deviceId: bigint): boolean {
    return this.state.get(deviceId.toString())?.phase === 'moving'
  }

  /** The start of a device's still-open trip (recompute persists it as an open row), or null. */
  openSnapshot(deviceId: bigint): { startTime: Date; startLat: number; startLon: number } | null {
    const trip = this.state.get(deviceId.toString())?.trip
    return trip ? { startTime: trip.startTime, startLat: trip.startLat, startLon: trip.startLon } : null
  }

  private step(r: NormalizedRecord, out: TripEvent[]): void {
    if (!r.fixValid) return // defensive: I5 — engine must never let an invalid fix count
    const key = r.deviceId.toString()
    const st = this.state.get(key) ?? { phase: 'parked' as const, cand: null, trip: null, lastSeen: null }
    this.state.set(key, st)
    // drop out-of-order records in EVERY phase — a buffered late batch (§3.6) must not
    // corrupt a candidate or fabricate a negative-duration trip; E04-2 recompute owns
    // authoritative reconciliation of late/replayed batches from durable positions.
    if (st.lastSeen !== null && r.fixTime.getTime() < st.lastSeen.getTime()) {
      const prev = this.late.get(key)
      if (prev === undefined || r.fixTime.getTime() < prev.getTime()) this.late.set(key, r.fixTime)
      return
    }
    st.lastSeen = r.fixTime
    const speed = r.speed ?? 0
    const t = this.thresholds

    if (st.phase === 'parked') {
      const moving = t.noIgnition ? speed > t.moveSpeedKmh : r.ignition === true && (r.movement === true || speed > t.moveSpeedKmh)
      if (!moving) {
        st.cand = null
        return
      }
      if (st.cand === null) {
        st.cand = { startTime: r.fixTime, startLat: r.lat, startLon: r.lon, startOdo: r.odometerM, lastLat: r.lat, lastLon: r.lon, dispM: 0, maxSpeed: speed }
      } else {
        st.cand.dispM += haversineM(st.cand.lastLat, st.cand.lastLon, r.lat, r.lon)
        st.cand.lastLat = r.lat
        st.cand.lastLon = r.lon
        if (speed > st.cand.maxSpeed) st.cand.maxSpeed = speed
      }
      if (secs(r.fixTime, st.cand.startTime) >= t.movingSustainS || st.cand.dispM >= t.movingDisplaceM) {
        // open retroactively from the candidate start; cand.dispM already holds the
        // path distance from start through the current record, so seed it directly
        // (no accumulate(r) — that would double-count the last segment)
        const c = st.cand
        out.push({ type: 'open', deviceId: r.deviceId, startTime: c.startTime, startLat: c.startLat, startLon: c.startLon })
        const odoMonotonic = c.startOdo !== null && r.odometerM !== null && r.odometerM >= c.startOdo
        st.trip = {
          startTime: c.startTime,
          startLat: c.startLat,
          startLon: c.startLon,
          lastLat: r.lat,
          lastLon: r.lon,
          lastTime: r.fixTime,
          haversineM: c.dispM,
          odoStart: c.startOdo,
          odoLast: r.odometerM,
          odoBroken: c.startOdo === null || r.odometerM === null || !odoMonotonic,
          maxSpeed: Math.max(c.maxSpeed, speed), // include the candidate window's peak
          idleS: 0,
          idleSince: null,
          stopSince: null,
        }
        st.phase = 'moving'
        st.cand = null
      }
      return
    }

    // ── moving ── (out-of-order already dropped by the lastSeen guard above)
    const trip = st.trip!
    this.accumulate(trip, r)

    // idle: ignition on (or noIgnition) and crawling
    const idling = (t.noIgnition || r.ignition === true) && speed < t.idleSpeedKmh
    if (idling) {
      if (trip.idleSince === null) trip.idleSince = r.fixTime
    } else {
      this.flushIdle(trip, r.fixTime)
    }

    // stop detection
    const stopped = t.noIgnition
      ? speed < t.moveSpeedKmh && haversineM(trip.lastLat, trip.lastLon, r.lat, r.lon) < t.parkedDisplaceM
      : r.ignition === false
    const stopThreshold = t.noIgnition ? t.parkedStopS : t.parkedIgnitionOffS
    if (stopped) {
      if (trip.stopSince === null) trip.stopSince = r.fixTime
      if (secs(r.fixTime, trip.stopSince) >= stopThreshold) {
        this.close(r.deviceId, st, trip.stopSince, out)
      }
    } else {
      trip.stopSince = null
    }
  }

  /** Distance/speed accumulation for one in-trip record. */
  private accumulate(trip: OpenTrip, r: NormalizedRecord): void {
    trip.haversineM += haversineM(trip.lastLat, trip.lastLon, r.lat, r.lon)
    if (r.odometerM === null || trip.odoLast === null || r.odometerM < trip.odoLast) {
      trip.odoBroken = true // missing or non-monotonic ⇒ odometer unusable for the trip
    }
    if (r.odometerM !== null) trip.odoLast = r.odometerM
    const speed = r.speed ?? 0
    if (speed > trip.maxSpeed) trip.maxSpeed = speed
    trip.lastLat = r.lat
    trip.lastLon = r.lon
    trip.lastTime = r.fixTime
  }

  private flushIdle(trip: OpenTrip, now: Date): void {
    if (trip.idleSince !== null) {
      const dur = secs(now, trip.idleSince)
      if (dur >= this.thresholds.idleSustainS) trip.idleS += Math.round(dur)
      trip.idleSince = null
    }
  }

  private close(deviceId: bigint, st: DeviceState, endTime: Date, out: TripEvent[]): void {
    const trip = st.trip!
    this.flushIdle(trip, endTime) // count a trailing idle stretch if it qualifies
    const odoUsable = !trip.odoBroken && trip.odoStart !== null && trip.odoLast !== null
    const odoM = odoUsable ? Number(trip.odoLast! - trip.odoStart!) : 0
    const distanceM = odoUsable ? Math.max(0, odoM) : Math.round(trip.haversineM)
    out.push({
      type: 'close',
      deviceId,
      startTime: trip.startTime,
      endTime,
      startLat: trip.startLat,
      startLon: trip.startLon,
      endLat: trip.lastLat,
      endLon: trip.lastLon,
      distanceM,
      distanceSource: odoUsable ? 'odometer' : 'gps',
      maxSpeed: Math.round(trip.maxSpeed),
      idleS: trip.idleS,
    })
    st.phase = 'parked'
    st.trip = null
    st.cand = null
  }
}
