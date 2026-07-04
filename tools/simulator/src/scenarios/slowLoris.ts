import { encodeAvlPacket } from '@orbetra/codec'

import { driveRecords } from '../drive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * Slow-loris attack (PROJECT_PLAN §7.2): a perfectly valid packet trickled
 * 1 byte every 5 s. The ingest server must kill the connection on its read-idle /
 * handshake timeout instead of holding a socket + buffer hostage (E01-5 AC).
 * `byteDelayMs` is honored by the client runner; tests use a small override.
 */
export const slowLoris: Scenario & { byteDelayMs: number } = {
  name: 'slowLoris',
  byteDelayMs: 5000,
  *packets(opts: ScenarioOpts) {
    const [rec] = driveRecords({ seed: opts.seed, count: 1, startMs: opts.startMs })
    yield encodeAvlPacket(8, [rec!])
  },
}
