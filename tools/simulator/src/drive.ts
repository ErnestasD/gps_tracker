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
  let distanceM = 0
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
      ]),
    })
  }
  return out
}
