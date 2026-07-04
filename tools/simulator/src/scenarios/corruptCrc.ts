import { liveDrive } from './liveDrive.js'
import type { Scenario, ScenarioOpts } from './types.js'

/**
 * Valid liveDrive packets with the CRC's last byte flipped — the server must
 * reply ACK=0 (records not persisted) and keep the session alive (E01-5 AC).
 */
export const corruptCrc: Scenario = {
  name: 'corruptCrc',
  *packets(opts: ScenarioOpts) {
    for (const pkt of liveDrive.packets(opts) as Iterable<Buffer>) {
      const bad = Buffer.from(pkt)
      bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff
      yield bad
    }
  },
}
