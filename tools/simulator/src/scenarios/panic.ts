import { encodeAvlPacket } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * Panic button: priority=2 record with a DIN1-triggered event (PROJECT_PLAN §3.4:
 * priority 2 = PANIC ⇒ immediate event bypassing rule-engine cooldowns; eventIoId
 * names the AVL id that triggered the eventual record — DIN1 = AVL 1, wiki FMB120 table).
 * Emits normal drive records with a panic record in the middle.
 */
export const panic: Scenario = {
  name: 'panic',
  *packets(opts: ScenarioOpts) {
    const records = driveRecords({ seed: opts.seed, count: opts.count, startMs: opts.startMs })
    const panicIndex = Math.floor(records.length / 2)
    for (const [i, rec] of records.entries()) {
      if (i === panicIndex) {
        const io = new Map(rec.io)
        io.set(1, 1n) // DIN1 pressed
        yield encodeAvlPacket(8, [{ ...rec, priority: 2, eventIoId: 1, io }])
      } else {
        yield encodeAvlPacket(8, [rec])
      }
    }
  },
}
