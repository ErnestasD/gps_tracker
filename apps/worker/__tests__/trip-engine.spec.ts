import type { NormalizedRecord } from '@orbetra/shared'
import { describe, expect, it } from 'vitest'

import { haversineM, motionRecords } from '../src/motion.js'
import { DEFAULT_THRESHOLDS, TripEngine, type CloseEvent, type TripEvent } from '../src/trip/engine.js'

/**
 * E04-1 trip state machine (§6.4), fixture-driven. Fixtures are synthetic position
 * sequences (real-device fixtures land after hardware, E01-6/E02-8 — W4 exit
 * validates ±5% vs a manual log). Thresholds = DEFAULT_THRESHOLDS unless noted.
 */

const T0 = 1_751_600_000_000
const DEV = 42n

interface Opt {
  lat?: number
  lon?: number
  speed?: number
  ign?: boolean | null
  mov?: boolean | null
  odo?: bigint | null
  fixValid?: boolean
}
const rec = (tSec: number, o: Opt = {}): NormalizedRecord => ({
  deviceId: DEV,
  fixTime: new Date(T0 + tSec * 1000),
  serverTime: new Date(T0 + tSec * 1000 + 100),
  lat: o.lat ?? 54.0,
  lon: o.lon ?? 25.0,
  altitude: 100,
  speed: o.speed ?? 0,
  course: 0,
  satellites: (o.fixValid ?? true) ? 9 : 0,
  fixValid: o.fixValid ?? true,
  ignition: o.ign ?? null,
  movement: o.mov ?? null,
  odometerM: o.odo ?? null,
  priority: 0,
  recHash: BigInt(T0 + tSec),
  attrs: {},
})

const closes = (ev: TripEvent[]): CloseEvent[] => ev.filter((e): e is CloseEvent => e.type === 'close')

/** A slow drive: moving points every 10 s, ~22 m apart (≈8 km/h), ignition on. */
function drive(fromSec: number, points: number, opts: { speed?: number; odoStart?: bigint; odoStep?: bigint } = {}): NormalizedRecord[] {
  const out: NormalizedRecord[] = []
  for (let i = 0; i < points; i++) {
    out.push(
      rec(fromSec + i * 10, {
        lat: 54.0 + i * 0.0002,
        speed: opts.speed ?? 8,
        ign: true,
        mov: true,
        ...(opts.odoStart !== undefined ? { odo: opts.odoStart + BigInt(i) * (opts.odoStep ?? 100n) } : {}),
      }),
    )
  }
  return out
}

describe('E04-1 trip state machine (§6.4)', () => {
  it('trip-basic: park→drive→stop opens once (sustain) and closes on ignition-off', () => {
    const moving = drive(0, 20) // t=0..190, opens by 90 s sustain (disp stays < 300 m)
    const lastLat = 54.0 + 19 * 0.0002
    const stop = [rec(200, { lat: lastLat, ign: false, speed: 0 }), rec(380, { lat: lastLat, ign: false, speed: 0 })]
    const ev = new TripEngine().feed([...moving, ...stop])

    const opens = ev.filter((e) => e.type === 'open')
    expect(opens).toHaveLength(1)
    expect(opens[0]!.startTime.getTime()).toBe(T0) // retroactive to candidate start
    const c = closes(ev)
    expect(c).toHaveLength(1)
    expect(c[0]!.endTime.getTime()).toBe(T0 + 200_000) // when it went ignition-off
    expect(c[0]!.distanceSource).toBe('gps')
    // distance = haversine over the moving points (stop segment adds 0)
    let expected = 0
    for (let i = 0; i < 19; i++) expected += haversineM(54.0 + i * 0.0002, 25, 54.0 + (i + 1) * 0.0002, 25)
    expect(c[0]!.distanceM).toBe(Math.round(expected))
    expect(c[0]!.maxSpeed).toBe(8)
    expect(c[0]!.idleS).toBe(0)
  })

  it('trip-open-by-displacement: a fast ≥300 m burst opens before the 90 s sustain', () => {
    const burst = [
      rec(0, { lat: 54.0, ign: true, mov: true, speed: 80 }),
      rec(10, { lat: 54.002, ign: true, mov: true, speed: 80 }), // ~222 m
      rec(20, { lat: 54.004, ign: true, mov: true, speed: 80 }), // ~444 m cumulative ≥ 300
    ]
    const ev = new TripEngine().feed(burst)
    const opens = ev.filter((e) => e.type === 'open')
    expect(opens).toHaveLength(1)
    expect(opens[0]!.startTime.getTime()).toBe(T0) // still retroactive to the burst start
  })

  it('trip-noise: a short jiggle under both thresholds opens NO trip', () => {
    const jiggle = [
      rec(0, { lat: 54.0, ign: true, mov: true, speed: 8 }),
      rec(10, { lat: 54.0002, ign: true, mov: true, speed: 8 }),
      rec(30, { lat: 54.0004, ign: true, mov: true, speed: 8 }), // 30 s, ~66 m — under 90 s AND 300 m
      rec(40, { lat: 54.0004, ign: false, speed: 0 }),
    ]
    expect(new TripEngine().feed(jiggle)).toHaveLength(0)
  })

  it('trip-idle: a sustained idle stretch mid-trip accrues to idleS', () => {
    const ev = new TripEngine().feed([
      ...drive(0, 10), // opens by ~t=90
      // idle: ignition on, crawling, position held (t=110..240)
      rec(110, { lat: 54.0018, ign: true, speed: 0 }),
      rec(240, { lat: 54.0018, ign: true, speed: 0 }),
      // resume driving → flushes the idle stretch from t=110 to now=250 (140 s ≥ 120 s)
      rec(250, { lat: 54.002, ign: true, mov: true, speed: 8 }),
      rec(260, { lat: 54.0022, ign: true, mov: true, speed: 8 }),
      // stop
      rec(270, { lat: 54.0022, ign: false, speed: 0 }),
      rec(450, { lat: 54.0022, ign: false, speed: 0 }),
    ])
    const c = closes(ev)
    expect(c).toHaveLength(1)
    expect(c[0]!.idleS).toBeGreaterThanOrEqual(120)
    expect(c[0]!.idleS).toBe(140) // t=110 → t=250
  })

  it('trip-odometer: a monotonic device odometer wins over haversine (distanceSource=odometer)', () => {
    const moving = drive(0, 20, { odoStart: 100_000n, odoStep: 100n }) // Δodo = 1900 m end-to-end
    const lastLat = 54.0 + 19 * 0.0002
    const stop = [rec(200, { lat: lastLat, ign: false, speed: 0, odo: 101_900n }), rec(380, { lat: lastLat, ign: false, speed: 0, odo: 101_900n })]
    const c = closes(new TripEngine().feed([...moving, ...stop]))
    expect(c[0]!.distanceSource).toBe('odometer')
    expect(c[0]!.distanceM).toBe(1900) // 101900 − 100000, NOT the ~400 m haversine
  })

  it('trip-odometer-broken: a non-monotonic odometer (reset) falls back to haversine/gps', () => {
    const moving = drive(0, 20, { odoStart: 100_000n, odoStep: 100n }).map((r, i) =>
      i === 10 ? { ...r, odometerM: 50_000n } : r, // mid-trip reset breaks monotonicity
    )
    const lastLat = 54.0 + 19 * 0.0002
    const stop = [rec(200, { lat: lastLat, ign: false, speed: 0 }), rec(380, { lat: lastLat, ign: false, speed: 0 })]
    const c = closes(new TripEngine().feed([...moving, ...stop]))
    expect(c[0]!.distanceSource).toBe('gps')
    expect(c[0]!.distanceM).toBeLessThan(1000) // haversine of the slow drive, not the odo delta
  })

  it('trip-no-ignition: asset profile opens/closes on speed+displacement without any ignition signal', () => {
    const t = { ...DEFAULT_THRESHOLDS, noIgnition: true, moveSpeedKmh: 3, movingSustainS: 300, parkedStopS: 300, parkedDisplaceM: 100 }
    const moving = [
      rec(0, { lat: 54.0, speed: 10 }),
      rec(120, { lat: 54.002, speed: 10 }),
      rec(300, { lat: 54.004, speed: 10 }), // ≥300 s sustained moving → open
    ]
    const stop = [rec(360, { lat: 54.004, speed: 0 }), rec(700, { lat: 54.004, speed: 0 })] // ≥300 s stopped → close
    const ev = new TripEngine(t).feed([...moving, ...stop])
    expect(ev.filter((e) => e.type === 'open')).toHaveLength(1)
    expect(closes(ev)).toHaveLength(1)
    // no record carried an ignition value — proves the asset path never reads ignition
    expect([...moving, ...stop].every((r) => r.ignition === null)).toBe(true)
  })

  it('I5: trip distance is identical with and without interleaved invalid fixes (filtered at the seam)', () => {
    const moving = drive(0, 20)
    const lastLat = 54.0 + 19 * 0.0002
    const stop = [rec(200, { lat: lastLat, ign: false, speed: 0 }), rec(380, { lat: lastLat, ign: false, speed: 0 })]
    const clean = [...moving, ...stop]
    // same drive, with §3.4 invalid fixes (last coords, sat=0) AND an adversarial teleport
    const dirty = [
      ...moving,
      rec(195, { lat: 0, lon: 0, ign: true, speed: 0, fixValid: false }), // teleport to null island
      rec(196, { lat: lastLat, ign: true, speed: 0, fixValid: false }),
      ...stop,
    ]
    const a = closes(new TripEngine().feed(motionRecords(clean)))
    const b = closes(new TripEngine().feed(motionRecords(dirty)))
    expect(a[0]!.distanceM).toBe(b[0]!.distanceM)
    expect(a[0]!.distanceM).toBeGreaterThan(0)
  })

  it('maxSpeed includes the candidate window (peak before the trip formally opens)', () => {
    const moving = [
      rec(0, { lat: 54.0, ign: true, mov: true, speed: 100 }), // candidate peak
      ...drive(10, 12, { speed: 20 }), // opens ~t=90 at a lower speed
    ]
    const lastLat = 54.0 + 11 * 0.0002
    const stop = [rec(200, { lat: lastLat, ign: false, speed: 0 }), rec(380, { lat: lastLat, ign: false, speed: 0 })]
    const c = closes(new TripEngine().feed([...moving, ...stop]))
    expect(c[0]!.maxSpeed).toBe(100) // not the 20 km/h of the open record
  })

  it('out-of-order: a buffered late batch (older fixTimes) is dropped, no negative-duration trip', () => {
    const engine = new TripEngine()
    // a live drive opens+closes a clean trip
    const moving = drive(1000, 20)
    const lastLat = 54.0 + 19 * 0.0002
    const clean = [...moving, rec(1200, { lat: lastLat, ign: false, speed: 0 }), rec(1380, { lat: lastLat, ign: false, speed: 0 })]
    const ev1 = engine.feed(clean)
    // now a buffered flood arrives with OLDER fixTimes — must be ignored entirely
    const ev2 = engine.feed(drive(0, 20))
    expect(ev2).toHaveLength(0)
    const c = closes(ev1)
    expect(c[0]!.endTime.getTime()).toBeGreaterThan(c[0]!.startTime.getTime()) // never negative duration
  })

  it("engine's own I5 guard: an invalid fix fed DIRECTLY (bypassing the seam) is ignored", () => {
    const moving = drive(0, 20)
    const lastLat = 54.0 + 19 * 0.0002
    const withInvalid = [
      ...moving.slice(0, 10),
      rec(100, { lat: 0, lon: 0, ign: true, speed: 999, fixValid: false }), // teleport, huge speed
      ...moving.slice(10),
      rec(200, { lat: lastLat, ign: false, speed: 0 }),
      rec(380, { lat: lastLat, ign: false, speed: 0 }),
    ]
    const clean = [...moving, rec(200, { lat: lastLat, ign: false, speed: 0 }), rec(380, { lat: lastLat, ign: false, speed: 0 })]
    const a = closes(new TripEngine().feed(clean)) // no filtering
    const b = closes(new TripEngine().feed(withInvalid)) // invalid fed straight in
    expect(b[0]!.distanceM).toBe(a[0]!.distanceM) // teleport ignored
    expect(b[0]!.maxSpeed).toBe(a[0]!.maxSpeed) // speed=999 ignored
  })

  it('back-to-back: after a trip closes the device opens a fresh trip', () => {
    const seg = (from: number, baseLat: number) => [
      ...Array.from({ length: 12 }, (_, i) => rec(from + i * 10, { lat: baseLat + i * 0.0002, ign: true, mov: true, speed: 8 })),
      rec(from + 130, { lat: baseLat + 11 * 0.0002, ign: false, speed: 0 }),
      rec(from + 320, { lat: baseLat + 11 * 0.0002, ign: false, speed: 0 }),
    ]
    const ev = new TripEngine().feed([...seg(0, 54.0), ...seg(700, 55.0)])
    expect(ev.filter((e) => e.type === 'open')).toHaveLength(2)
    expect(closes(ev)).toHaveLength(2)
  })

  it('a brief sub-threshold ignition-off does NOT close the trip', () => {
    const ev = new TripEngine().feed([
      ...drive(0, 12), // opens ~t=90
      rec(200, { lat: 54.0022, ign: false, speed: 0 }), // ign off, but only briefly…
      rec(260, { lat: 54.0022, ign: true, mov: true, speed: 8 }), // …resumes < 180 s later
      rec(300, { lat: 54.0024, ign: true, mov: true, speed: 8 }),
      rec(310, { lat: 54.0024, ign: false, speed: 0 }),
      rec(500, { lat: 54.0024, ign: false, speed: 0 }), // now a real ≥180 s stop
    ])
    expect(closes(ev)).toHaveLength(1) // exactly one trip, not split by the blip
    expect(closes(ev)[0]!.endTime.getTime()).toBe(T0 + 310_000)
  })

  it('ignition=null in an ignition profile neither opens nor closes (unknown state)', () => {
    // never opens: PARKED→MOVING requires ignition===true
    const noOpen = new TripEngine().feed(drive(0, 20).map((r) => ({ ...r, ignition: null })))
    expect(noOpen).toHaveLength(0)
    // once moving, an ignition=null stretch does NOT close (stays open → E04-2 territory)
    const ev = new TripEngine().feed([
      ...drive(0, 12), // opens
      rec(200, { lat: 54.0022, ign: null, speed: 0 }),
      rec(500, { lat: 54.0022, ign: null, speed: 0 }),
    ])
    expect(closes(ev)).toHaveLength(0) // no close emitted while ignition is unknown
  })

  it('per-device state is independent (two devices interleaved)', () => {
    const engine = new TripEngine()
    const recD = (dev: bigint, tSec: number, o: Opt): NormalizedRecord => ({ ...rec(tSec, o), deviceId: dev })
    const batch: NormalizedRecord[] = []
    for (let i = 0; i < 20; i++) {
      batch.push(recD(1n, i * 10, { lat: 54 + i * 0.0002, ign: true, mov: true, speed: 8 }))
      batch.push(recD(2n, i * 10, { lat: 55 + i * 0.0002, ign: true, mov: true, speed: 8 }))
    }
    const ev = engine.feed(batch)
    expect(ev.filter((e) => e.type === 'open' && e.deviceId === 1n)).toHaveLength(1)
    expect(ev.filter((e) => e.type === 'open' && e.deviceId === 2n)).toHaveLength(1)
  })
})
