import { encodeAvlPacket } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * The shape the wiki does not document and §3.4 does not model: **0/0 with a full satellite count**.
 *
 * `invalidFix` reproduces §3.4's no-fix sequence (last valid coords, satellites 0), which the
 * pipeline has always handled. On 2026-08-20 an FTC887 produced something else — lat 0, lon 0 with
 * 34–37 satellites and speed 0 — and `fix_valid := satellites > 0` called every one of them a valid
 * fix. The vehicle appeared in the Gulf of Guinea mid-drive, a trip opened there, and a geofence
 * exit was one zone away from firing (ADR-039).
 *
 * There was no end-to-end coverage of that path, which is how the defect reached the founder's
 * screen and how a second leak (the live trail) later survived the first fix: both were verified
 * only by unit tests on modules in isolation. Every fourth record here is the real shape, dropped
 * into an ordinary drive, so ingest → worker → WS → map is exercised the way the hardware did it.
 *
 * Downstream expectation: these records are STORED (attrs intact, presence and IO still count) and
 * must never place a marker, extend a trail, accumulate trip distance or move a geofence.
 */
export const nullIsland: Scenario = {
  name: 'nullIsland',
  *packets(opts: ScenarioOpts) {
    const records = driveRecords({ seed: opts.seed, count: opts.count, startMs: opts.startMs, startDistanceM: opts.startDistanceM, parkTailS: opts.parkTailS })
    for (const [i, rec] of records.entries()) {
      if (i % 4 === 3) {
        yield encodeAvlPacket(8, [
          {
            ...rec, // keeps its own timestamp and IO — the device believed this was a real report
            lat: 0,
            lon: 0,
            angle: 0,
            // the whole point: a satellite count that PASSES §3.4's rule
            satellites: 37,
            speed: 0,
          },
        ])
      } else {
        yield encodeAvlPacket(8, [rec])
      }
    }
  },
}
