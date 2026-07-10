import { encodeAvlPacket } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * Panic button: priority=2 record with an Alarm-triggered event (PROJECT_PLAN §3.4:
 * priority 2 = PANIC ⇒ immediate event bypassing rule-engine cooldowns). The record
 * carries **Alarm = AVL 236** (the id the worker's `panic` rule kind edge-detects on)
 * with 236=0 as the baseline on every other record — an edge detector needs a
 * known-false previous value — plus DIN1 (AVL 1) for realism. Both ids per the wiki
 * FMB120 table: https://wiki.teltonika-gps.com/view/FMB120_Teltonika_Data_Sending_Parameters_ID
 * The panic lands mid-DRIVE (before any parked ignition-off tail).
 */
export const panic: Scenario = {
  name: 'panic',
  *packets(opts: ScenarioOpts) {
    const records = driveRecords({ seed: opts.seed, count: opts.count, startMs: opts.startMs, startDistanceM: opts.startDistanceM, parkTailS: opts.parkTailS })
    // index over the PRE-TAIL drive records: opts.count is the drive length; parkTailS
    // appends stationary tail records after it (a "panic" while parked would look silly)
    const panicIndex = Math.floor(Math.min(opts.count, records.length) / 2)
    for (const [i, rec] of records.entries()) {
      const io = new Map(rec.io)
      if (i === panicIndex) {
        io.set(236, 1n) // Alarm event occurred — the panic rule's trigger id
        io.set(1, 1n) // DIN1 pressed
        yield encodeAvlPacket(8, [{ ...rec, priority: 2, eventIoId: 236, io }])
      } else {
        io.set(236, 0n) // known-false baseline so the rule engine sees a rising EDGE
        yield encodeAvlPacket(8, [{ ...rec, io }])
      }
    }
  },
}
