import { fileURLToPath } from 'node:url'

import { encodeAvlPacket, type EncodableRecord } from '@orbetra/codec'

import { lcg } from '../lcg.js'
import { Route } from '../route.js'
import type { Scenario, ScenarioOpts } from './types.js'

const ROUTE_PATH = fileURLToPath(new URL('../routes/vilnius-loop.geojson', import.meta.url))

/**
 * Synthetic drive along the Vilnius loop at 1 Hz (PROJECT_PLAN §7.2 live-drive):
 * ignition on, movement on, speed 30–70 km/h (seeded), one record per packet
 * (matching a live device's default sending behaviour).
 */
export const liveDrive: Scenario = {
  name: 'liveDrive',
  *packets(opts: ScenarioOpts) {
    const rnd = lcg(opts.seed)
    const route = new Route(ROUTE_PATH)
    // hz controls wire pacing (client); record timestamps always step by 1/hz s,
    // with hz<=0 meaning "send as fast as possible, records 1 s apart"
    const stepS = opts.hz > 0 ? 1 / opts.hz : 1
    let distanceM = 0
    for (let i = 0; i < opts.count; i++) {
      const speedKmh = Math.round(30 + rnd() * 40)
      distanceM += (speedKmh / 3.6) * stepS
      const p = route.at(distanceM)
      const rec: EncodableRecord = {
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
          [21, BigInt(3 + Math.floor(rnd() * 3))], // GSM Signal 3..5
          [66, BigInt(12300 + Math.floor(rnd() * 400))], // External Voltage, mV raw
        ]),
      }
      yield encodeAvlPacket(8, [rec])
    }
  },
}
