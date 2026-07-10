import { fileURLToPath } from 'node:url'

import type { EncodableRecord } from '@orbetra/codec'

import { lcg } from './lcg.js'
import { Route } from './route.js'

const ROUTE_PATH = fileURLToPath(new URL('./routes/vilnius-loop.geojson', import.meta.url))

export interface DriveOpts {
  seed: number
  count: number
  startMs: number
  /** Seconds between consecutive records (default 1). */
  stepS?: number
  /** Start this far along the route (default 0). Route.at() wraps modulo route
   * length, so any offset is safe — fleet mode spreads devices with this. */
  startDistanceM?: number
  /** Append a stationary ignition-OFF tail this long (seconds, 30 s record spacing).
   * The trip engine closes a trip only after ignition-off is SUSTAINED past
   * parkedIgnitionOffS (default 180 s) — without a tail a replayed drive leaves a
   * forever-open trip (E08-5 review HIGH-2). */
  parkTailS?: number
}

/**
 * Shared route-record synthesis (extracted in E02-2 so bufferedFlood/invalidFix
 * produce records identical in shape to liveDrive's): ignition+movement on,
 * speed 30–70 km/h seeded, GPS along the Vilnius loop.
 */
export function driveRecords(opts: DriveOpts): EncodableRecord[] {
  const rnd = lcg(opts.seed)
  const route = new Route(ROUTE_PATH)
  const stepS = opts.stepS ?? 1
  const out: EncodableRecord[] = []
  let distanceM = opts.startDistanceM ?? 0
  for (let i = 0; i < opts.count; i++) {
    const speedKmh = Math.round(30 + rnd() * 40)
    distanceM += (speedKmh / 3.6) * stepS
    const p = route.at(distanceM)
    out.push({
      tsMs: opts.startMs + Math.round(i * 1000 * stepS),
      priority: 0,
      lat: Math.round(p.lat * 1e7) / 1e7,
      lon: Math.round(p.lon * 1e7) / 1e7,
      altitude: 120,
      angle: p.angle,
      satellites: 8 + Math.floor(rnd() * 7),
      speed: speedKmh,
      eventIoId: 0,
      io: new Map<number, bigint | Buffer>([
        [239, 1n], // Ignition (wiki FMB120 table)
        [240, 1n], // Movement
        [21, BigInt(3 + Math.floor(rnd() * 3))], // GSM Signal
        [66, BigInt(12300 + Math.floor(rnd() * 400))], // External Voltage, mV raw
        // Fuel level % (AVL 89) — drains ~1% per km driven, floored at 5, so playback's
        // fuel graph (E08-3) has realistic data.
        // https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
        [89, BigInt(Math.max(5, 90 - Math.floor(distanceM / 1000)))],
      ]),
    })
  }
  if (opts.parkTailS !== undefined && opts.parkTailS > 0 && out.length > 0) {
    const last = out[out.length - 1]!
    const tailSteps = Math.ceil(opts.parkTailS / 30)
    for (let j = 1; j <= tailSteps; j++) {
      const io = new Map(last.io)
      io.set(239, 0n) // Ignition off (wiki FMB120 table)
      io.set(240, 0n) // Movement off
      out.push({ ...last, tsMs: last.tsMs + j * 30_000, speed: 0, angle: last.angle, io })
    }
  }
  return out
}
