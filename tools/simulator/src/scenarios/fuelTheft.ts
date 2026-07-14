import { encodeAvlPacket } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * Fuel theft: a drive, then a parked (ignition-OFF) tail during which the fuel level DROPS sharply —
 * the signature the worker's `fuel_theft` rule flags (a large drop while the engine is off can't be
 * consumption). Fuel level is **AVL 89** (Fuel Level %, per the wiki FMB120 table:
 * https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID); it holds steady
 * at 80% across the drive + tail, then drops to 55% on the final parked record (a 25% siphon). Needs
 * parkTailS ≥ 60 s so there are ≥2 ignition-off records to bracket the drop.
 */
export const fuelTheft: Scenario = {
  name: 'fuel-theft',
  *packets(opts: ScenarioOpts) {
    const records = driveRecords({ seed: opts.seed, count: opts.count, startMs: opts.startMs, startDistanceM: opts.startDistanceM, parkTailS: opts.parkTailS ?? 120 })
    const lastIdx = records.length - 1
    for (const [i, rec] of records.entries()) {
      const io = new Map(rec.io)
      io.set(89, i === lastIdx ? 55n : 80n) // steady 80%, then a 25% drop on the last parked record
      yield encodeAvlPacket(8, [{ ...rec, io }])
    }
  },
}
