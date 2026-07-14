import { encodeAvlPacket } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * Fuel theft: a drive, then a parked (ignition-OFF) tail during which the fuel level DROPS sharply —
 * the signature the worker's `fuel_theft` rule flags (a large drop while the engine is off can't be
 * consumption). Fuel level is **AVL 89** (Fuel Level %, per the wiki FMB120 table:
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID); it holds steady
 * at 80% across the drive + tail, then drops to 55% on the last TWO parked records — the worker's
 * fuel_theft rule needs the drop CONFIRMED on two consecutive parked readings (single-glitch debounce),
 * so a lone final drop wouldn't alert. Needs parkTailS ≥ 90 s (≥3 ignition-off records: baseline + 2 low).
 */
export const fuelTheft: Scenario = {
  name: 'fuel-theft',
  *packets(opts: ScenarioOpts) {
    const records = driveRecords({ seed: opts.seed, count: opts.count, startMs: opts.startMs, startDistanceM: opts.startDistanceM, parkTailS: opts.parkTailS ?? 150 })
    const lastIdx = records.length - 1
    for (const [i, rec] of records.entries()) {
      const io = new Map(rec.io)
      io.set(89, i >= lastIdx - 1 ? 55n : 80n) // steady 80%, then a confirmed 25% drop on the last two records
      yield encodeAvlPacket(8, [{ ...rec, io }])
    }
  },
}
