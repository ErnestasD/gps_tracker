import { encodeAvlPacket, type EncodableRecord } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * Invalid-fix sequences per the wiki rule (PROJECT_PLAN §3.4): when the device has
 * no GPS fix it sends the LAST VALID lat/lon/alt with angle=0, satellites=0, speed=0.
 * Every third record here is such an invalid fix — downstream must treat them per
 * invariant I5 (no trip distance, no geofence, trail gap).
 */
export const invalidFix: Scenario = {
  name: 'invalidFix',
  *packets(opts: ScenarioOpts) {
    const records = driveRecords({ seed: opts.seed, count: opts.count, startMs: opts.startMs, startDistanceM: opts.startDistanceM, parkTailS: opts.parkTailS })
    let lastValid: EncodableRecord | null = null
    for (const [i, rec] of records.entries()) {
      if (i % 3 === 2 && lastValid) {
        yield encodeAvlPacket(8, [
          {
            ...rec, // keeps its own timestamp and IO
            lat: lastValid.lat,
            lon: lastValid.lon,
            altitude: lastValid.altitude,
            angle: 0,
            satellites: 0,
            speed: 0,
          },
        ])
      } else {
        lastValid = rec
        yield encodeAvlPacket(8, [rec])
      }
    }
  },
}
