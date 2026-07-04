import { encodeAvlPacket } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/** Max AVL packet size per PROJECT_PLAN §3.3 (wiki: 1280 B general limit). */
const MAX_PACKET_BYTES = 1280

/**
 * GSM-loss reality (PROJECT_PLAN §3.6): device reconnects and floods stored records
 * with ORIGINAL timestamps, oldest-first, packed into maximum-size packets at wire
 * speed. Default 300 records spanning the last 2 hours (hz pacing is ignored — the
 * runner's per-packet ACK wait is the only throttle, like a real device).
 */
export const bufferedFlood: Scenario = {
  name: 'bufferedFlood',
  *packets(opts: ScenarioOpts) {
    const count = opts.count > 1 ? opts.count : 300
    const spanMs = 2 * 3600 * 1000
    const startMs = opts.startMs - spanMs
    const stepS = spanMs / 1000 / count
    const records = driveRecords({ seed: opts.seed, count, startMs, stepS })

    // pack oldest-first records into packets as close to the 1280 B cap as possible
    let batch: typeof records = []
    for (const rec of records) {
      const candidate = encodeAvlPacket(8, [...batch, rec])
      if (candidate.length > MAX_PACKET_BYTES && batch.length > 0) {
        yield encodeAvlPacket(8, batch)
        batch = [rec]
      } else {
        batch.push(rec)
      }
    }
    if (batch.length > 0) yield encodeAvlPacket(8, batch)
  },
}
