import { encodeAvlPacket } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * Synthetic drive along the Vilnius loop at 1 Hz (PROJECT_PLAN §7.2 live-drive):
 * one record per packet, matching a live device's default sending behaviour.
 * hz controls wire pacing (client); record timestamps step by 1/hz s
 * (hz<=0 = send as fast as possible, records 1 s apart).
 */
export const liveDrive: Scenario = {
  name: 'liveDrive',
  *packets(opts: ScenarioOpts) {
    const stepS = opts.hz > 0 ? 1 / opts.hz : 1
    for (const rec of driveRecords({
      seed: opts.seed,
      count: opts.count,
      startMs: opts.startMs,
      stepS,
      startDistanceM: opts.startDistanceM,
      parkTailS: opts.parkTailS,
    })) {
      yield encodeAvlPacket(8, [rec])
    }
  },
}
